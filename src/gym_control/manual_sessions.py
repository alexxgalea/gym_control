"""Sesiuni manuale (#12): Adminul adaugă o Sesiune sau corectează una deschisă (Ieșire uitată).

Reguli:
- Motivul e obligatoriu (gol sau doar spații -> refuzat, nimic nu se schimbă).
- Ieșirea trebuie să fie după Intrare și să nu fie în viitor față de ceasul injectat.
- Suprapunere: o Sesiune manuală (adăugată sau corectată) care se suprapune peste o altă Sesiune
  a aceluiași Angajat (inclusiv una deschisă) e REFUZATĂ cu mesaj clar; intervalele adiacente
  (Ieșire = Intrarea următoare) sunt permise.
- Sesiunile adăugate sunt închise (`exit_at` setat), deci nu afectează `presence.open_session`.
- Corectarea închide Sesiunea (exit_method 'manual', is_manual=1, manual_reason) și rezolvă
  Anomaliile `missing_exit` și `open_at_closing` în aceeași operație.
- Fiecare acțiune intră în Jurnal (kind 'manual_session', cu autor; detail: method 'manual',
  session_id, reason).
"""

import sqlite3
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from gym_control import anomalies, journal, reports
from gym_control import auth
from gym_control.admin_api import ErrorResponse, FieldErrorResponse
from gym_control.auth import Admin, require_admin_api
from gym_control.clocktime import local_iso, parse_local
from gym_control.db import get_db

router = APIRouter(prefix="/api/admin/sessions", tags=["sessions"],
                   dependencies=[Depends(auth.require_same_origin)])

METHOD_MANUAL = "manual"
KIND = "manual_session"


class InvalidManualSession(ValueError):
    """Mesajul (în română) este afișat Adminului; `field` e câmpul din formular vizat (dacă e cazul)."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.field = field


def _parse(raw: str, label: str, tz: str, field: str) -> datetime:
    try:
        return parse_local(raw, label, tz, reports.InvalidInterval)
    except reports.InvalidInterval as exc:
        raise InvalidManualSession(str(exc), field) from exc


def _reason(raw: str) -> str:
    reason = " ".join((raw or "").split())
    if not reason:
        raise InvalidManualSession("Motivul este obligatoriu. Spune de ce se introduce manual această Sesiune.", "reason")
    return reason


def _check_interval(db, tz, now, employee_id, entry: datetime, exit_: datetime, ignore_id=None):
    if exit_ <= entry:
        raise InvalidManualSession("Ieșirea trebuie să fie după Intrare.", "exit_at")
    if exit_ > now:
        raise InvalidManualSession("Ieșirea nu poate fi în viitor.", "exit_at")
    clash = db.execute(
        "SELECT entry_at, exit_at FROM sessions WHERE employee_id = ? AND id IS NOT ?"
        " AND entry_at < ? AND (exit_at IS NULL OR exit_at > ?) ORDER BY entry_at LIMIT 1",
        (employee_id, ignore_id, exit_.isoformat(), entry.isoformat()),
    ).fetchone()
    if clash:
        other = local_iso(clash["entry_at"], tz) + " – " + (
            local_iso(clash["exit_at"], tz) if clash["exit_at"] else "deschisă")
        raise InvalidManualSession(
            f"Intervalul se suprapune cu o altă Sesiune a Angajatului ({other}). "
            "Alege un interval care nu se suprapune.", "entry_at")


def add_session(db, now, tz, admin: Admin, employee_id: int | None, raw_entry: str, raw_exit: str,
                raw_reason: str) -> int:
    """Adaugă o Sesiune manuală închisă. Ridică InvalidManualSession; apelantul comite."""
    reason = _reason(raw_reason)
    if employee_id is None:
        raise InvalidManualSession("Alege un Angajat.", "employee_id")
    employee = db.execute("SELECT id, name FROM employees WHERE id = ?", (employee_id,)).fetchone()
    if employee is None:
        raise InvalidManualSession("Angajatul ales nu există.", "employee_id")
    entry = _parse(raw_entry, "Intrare", tz, "entry_at")
    exit_ = _parse(raw_exit, "Ieșire", tz, "exit_at")
    _check_interval(db, tz, now, employee_id, entry, exit_)
    session_id = db.execute(
        "INSERT INTO sessions (employee_id, entry_at, exit_at, entry_method, exit_method,"
        " is_manual, manual_reason) VALUES (?,?,?,?,?,1,?)",
        (employee_id, entry.isoformat(), exit_.isoformat(), METHOD_MANUAL, METHOD_MANUAL, reason),
    ).lastrowid
    journal.write(
        db, now, kind=KIND, action="session.manual_add", author=admin, employee_id=employee_id,
        summary=(f"Sesiune manuală adăugată: {employee['name']}, {local_iso(entry, tz)} – "
                 f"{local_iso(exit_, tz)}. Motiv: {reason}"),
        detail={"method": METHOD_MANUAL, "session_id": session_id, "reason": reason},
    )
    journal_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    db.execute("UPDATE sessions SET entry_journal_id = ?, exit_journal_id = ? WHERE id = ?",
               (journal_id, journal_id, session_id))
    return session_id


def open_session_row(db, session_id: int):
    row = db.execute(
        "SELECT s.*, e.name AS employee_name FROM sessions s JOIN employees e ON e.id = s.employee_id"
        " WHERE s.id = ?", (session_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Sesiune inexistentă")
    return row


def correct_session(db, now, tz, admin: Admin, row, raw_exit: str, raw_reason: str) -> None:
    """Închide o Sesiune deschisă cu o Ieșire manuală și îi rezolvă Anomaliile. Apelantul comite."""
    reason = _reason(raw_reason)
    exit_ = _parse(raw_exit, "Ieșire", tz, "exit_at")
    entry = datetime.fromisoformat(row["entry_at"])
    _check_interval(db, tz, now, row["employee_id"], entry, exit_, ignore_id=row["id"])
    journal.write(
        db, now, kind=KIND, action="session.manual_correct", author=admin,
        employee_id=row["employee_id"],
        summary=(f"Sesiune corectată manual: {row['employee_name']}, Ieșire la {local_iso(exit_, tz)}. "
                 f"Motiv: {reason}"),
        detail={"method": METHOD_MANUAL, "session_id": row["id"], "reason": reason},
    )
    journal_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    db.execute(
        "UPDATE sessions SET exit_at = ?, exit_method = ?, exit_journal_id = ?, is_manual = 1,"
        " manual_reason = ? WHERE id = ?",
        (exit_.isoformat(), METHOD_MANUAL, journal_id, reason, row["id"]),
    )
    for code in (anomalies.MISSING_EXIT, anomalies.OPEN_AT_CLOSING):
        anomalies.resolve(db, row["id"], code, now)


class SessionIn(BaseModel):
    employee_id: int | None = None
    entry_at: str = ""  # ora locală a Sălii: AAAA-LL-ZZTHH:MM
    exit_at: str = ""
    reason: str = ""


class SessionCorrection(BaseModel):
    exit_at: str = ""
    reason: str = ""


class SessionOut(BaseModel):
    id: int


def _invalid(exc: InvalidManualSession) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc), "field": exc.field})


@router.post(
    "", status_code=201, response_model=SessionOut,
    responses={400: {"model": FieldErrorResponse}, 401: {"model": ErrorResponse}},
)
def create(body: SessionIn, request: Request, admin: Admin = Depends(require_admin_api),
           db: sqlite3.Connection = Depends(get_db)):
    try:
        session_id = add_session(
            db, request.app.state.clock(), request.app.state.settings.timezone, admin,
            body.employee_id, body.entry_at, body.exit_at, body.reason)
    except InvalidManualSession as exc:
        db.rollback()
        return _invalid(exc)
    db.commit()
    return SessionOut(id=session_id)


@router.post(
    "/{session_id}/correct", status_code=204,
    responses={400: {"model": FieldErrorResponse}, 401: {"model": ErrorResponse},
               404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def correct(session_id: int, body: SessionCorrection, request: Request,
            admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db)):
    row = open_session_row(db, session_id)
    if row["exit_at"] is not None:
        raise HTTPException(status_code=409, detail="Sesiunea e deja închisă.")
    try:
        correct_session(db, request.app.state.clock(), request.app.state.settings.timezone,
                        admin, row, body.exit_at, body.reason)
    except InvalidManualSession as exc:
        db.rollback()
        return _invalid(exc)
    db.commit()
    return Response(status_code=204)
