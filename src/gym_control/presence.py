"""Intrare/Ieșire: starea Angajatului, Sesiunile și ecranul /me.

API reutilizabil de tichetele următoare:
- `open_session`: starea Angajatului (Sesiune deschisă sau None);
- `is_old`: regula „Sesiune deschisă veche” (#8);
- `record_entry` / `record_exit`: scriu Sesiunea și Jurnalul; întorc None sau mesajul de respingere.
Identitatea vine doar din cookie (`require_employee`).
"""

import sqlite3
from dataclasses import dataclass
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse

from gym_control import journal
from gym_control.clocktime import local_day, local_hm
from gym_control.db import get_db
from gym_control.enrollment import Employee, require_employee
from gym_control.templates import templates

router = APIRouter()

METHOD_NONE = "none"  # fără validare de rețea/QR (pasul intermediar #5)


@dataclass(frozen=True)
class OpenSession:
    id: int
    entry_at: datetime


def open_session(db: sqlite3.Connection, employee_id: int) -> OpenSession | None:
    row = db.execute(
        "SELECT id, entry_at FROM sessions WHERE employee_id = ? AND exit_at IS NULL",
        (employee_id,),
    ).fetchone()
    return OpenSession(row["id"], datetime.fromisoformat(row["entry_at"])) if row else None


def is_old(session: OpenSession, now: datetime, tz: str) -> bool:
    """Regula „veche”: Sesiunea a fost deschisă într-o zi locală anterioară. Singurul loc al regulii."""
    return local_day(session.entry_at, tz) < local_day(now, tz)


def _journal_event(db, now, kind, employee, detail) -> int:
    journal.write(
        db, now, kind=kind, action=kind,
        summary=f"{'Intrare' if kind == 'entry' else 'Ieșire'}: {employee.name}",
        employee_id=employee.id, detail=detail,
    )
    return db.execute("SELECT last_insert_rowid()").fetchone()[0]


def record_entry(db: sqlite3.Connection, now: datetime, tz: str, employee: Employee) -> str | None:
    """Înregistrează Intrarea. Întoarce None la succes sau mesajul de respingere."""
    current = open_session(db, employee.id)
    if current is not None:
        # #8: aici o Sesiune veche (`is_old`) va fi marcată Anomalie, iar Intrarea acceptată.
        # Deocamdată orice Sesiune deschisă blochează Intrarea.
        return f"Ești deja în Sală din {local_hm(current.entry_at, tz)}. Nu poți face o a doua Intrare."
    journal_id = _journal_event(db, now, "entry", employee, {"method": METHOD_NONE})
    db.execute(
        "INSERT INTO sessions (employee_id, entry_at, entry_method, entry_journal_id) VALUES (?,?,?,?)",
        (employee.id, now.isoformat(), METHOD_NONE, journal_id),
    )
    db.commit()
    return None


def record_exit(db: sqlite3.Connection, now: datetime, tz: str, employee: Employee) -> str | None:
    current = open_session(db, employee.id)
    if current is None:
        return "Nu ai o Intrare deschisă, deci nu poți face Ieșire. Fă mai întâi Intrare."
    journal_id = _journal_event(db, now, "exit", employee, {"method": METHOD_NONE, "session_id": current.id})
    db.execute(
        "UPDATE sessions SET exit_at = ?, exit_method = ?, exit_journal_id = ? WHERE id = ?",
        (now.isoformat(), METHOD_NONE, journal_id, current.id),
    )
    db.commit()
    return None


def _page(request, db, employee, status_code=200, error=None, done=None):
    tz = request.app.state.settings.timezone
    current = open_session(db, employee.id)
    return templates.TemplateResponse(
        request, "me.html",
        {
            "employee": employee,
            "inside_since": local_hm(current.entry_at, tz) if current else None,
            "error": error,
            "done": done,
        },
        status_code=status_code,
    )


@router.get("/me", response_class=HTMLResponse)
def me(request: Request, employee: Employee = Depends(require_employee),
       db: sqlite3.Connection = Depends(get_db)):
    return _page(request, db, employee)


def _event(request, db, employee, record, label):
    now = request.app.state.clock()
    tz = request.app.state.settings.timezone
    error = record(db, now, tz, employee)
    if error:
        return _page(request, db, employee, status_code=409, error=error)
    return _page(request, db, employee, done=f"{label} înregistrată la {local_hm(now, tz)}")


@router.post("/me/entry", response_class=HTMLResponse)
def entry(request: Request, employee: Employee = Depends(require_employee),
          db: sqlite3.Connection = Depends(get_db)):
    return _event(request, db, employee, record_entry, "Intrare")


@router.post("/me/exit", response_class=HTMLResponse)
def exit_(request: Request, employee: Employee = Depends(require_employee),
          db: sqlite3.Connection = Depends(get_db)):
    return _event(request, db, employee, record_exit, "Ieșire")
