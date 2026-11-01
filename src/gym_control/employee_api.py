"""API-ul JSON al Angajatului (`/api/employee/*`), servit punctului de intrare Angajat al frontend-ului."""

import sqlite3

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from gym_control import employee_errors, network, presence, totp
from gym_control.clocktime import local_hm
from gym_control.db import get_db
from gym_control.enrollment import Employee, require_employee
from gym_control.network import require_hall_network

router = APIRouter(prefix="/api/employee", tags=["employee"])


class ConnectionStatus(BaseModel):
    in_hall: bool
    server_time: str  # ISO 8601, UTC; interfața o formatează în ora Sălii
    time_zone: str  # fusul Sălii (IANA)


@router.get("/status", response_model=ConnectionStatus)
def connection_status(request: Request, db: sqlite3.Connection = Depends(get_db)) -> ConnectionStatus:
    """Verificare conexiune: dacă cererea e în rețeaua Sălii și ora serverului. Nu cere rețeaua Sălii."""
    return ConnectionStatus(
        in_hall=network.in_hall(request, db),
        server_time=request.app.state.clock().isoformat(),
        time_zone=request.app.state.settings.timezone,
    )


class MeState(BaseModel):
    name: str
    inside_since: str | None  # ISO 8601 (UTC) al Intrării deschise; None dacă Angajatul e în afara Sălii
    server_time: str
    time_zone: str


class EventRequest(BaseModel):
    totp: str = ""  # codul din QR-ul de la ușă


class EventResult(BaseModel):
    message: str  # de ex. „Intrare înregistrată la 17:42”
    at: str  # ISO 8601 (UTC)
    time_zone: str


@router.get("/me", response_model=MeState, responses={401: {"description": "Telefon neactivat (`phone_not_activated`)"}})
def me_state(request: Request, employee: Employee = Depends(require_employee),
             db: sqlite3.Connection = Depends(get_db)) -> MeState:
    """Starea curentă a Angajatului: numele și Intrarea deschisă, dacă există."""
    current = presence.open_session(db, employee.id)
    return MeState(
        name=employee.name,
        inside_since=current.entry_at.isoformat() if current else None,
        server_time=request.app.state.clock().isoformat(),
        time_zone=request.app.state.settings.timezone,
    )


ERROR_RESPONSES = {
    401: {"description": "Telefon neactivat (`phone_not_activated`)"},
    403: {"description": "Rețea greșită (`not_in_hall_network`) sau cod greșit/expirat (`code_invalid`)"},
    409: {"description": "Conflict: `no_open_entry` (Ieșire fără Intrare) sau `already_inside`"},
}


def _event(request, db, employee, record, label, reason, body: EventRequest | None):
    now = request.app.state.clock()
    tz = request.app.state.settings.timezone
    check = totp.check(request.app.state.totp_secret, now, body.totp if body else "")  # doar ceasul serverului
    if check != totp.OK:
        return employee_errors.employee_error(403, employee_errors.CODE_INVALID, totp.reject_message(check))
    # un cod scanat dovedește prezența la ușă pentru o singură acțiune: următoarea cere un cod dintr-o fereastră nouă
    last = presence.last_event_at(db, employee.id)
    used = totp.accepted_window(request.app.state.totp_secret, now, body.totp if body else "")
    if last is not None and used is not None and used <= totp.window_of(last):
        return employee_errors.employee_error(
            403, employee_errors.CODE_INVALID, "Codul QR a fost deja folosit. Scanează din nou QR-ul de la ușă.")
    error = record(db, now, tz, employee, request.app.state.settings, presence.METHOD_QR_TOTP)
    if error:
        return employee_errors.employee_error(409, reason, error)
    return EventResult(message=f"{label} înregistrată la {local_hm(now, tz)}", at=now.isoformat(), time_zone=tz)


@router.post("/entry", response_model=EventResult, responses=ERROR_RESPONSES,
             dependencies=[Depends(require_hall_network)])
def entry(request: Request, body: EventRequest | None = None, employee: Employee = Depends(require_employee),
          db: sqlite3.Connection = Depends(get_db)):
    return _event(request, db, employee, presence.record_entry, "Intrare", employee_errors.ALREADY_INSIDE, body)


@router.post("/exit", response_model=EventResult, responses=ERROR_RESPONSES,
             dependencies=[Depends(require_hall_network)])
def exit_(request: Request, body: EventRequest | None = None, employee: Employee = Depends(require_employee),
          db: sqlite3.Connection = Depends(get_db)):
    return _event(request, db, employee, presence.record_exit, "Ieșire", employee_errors.NO_OPEN_ENTRY, body)
