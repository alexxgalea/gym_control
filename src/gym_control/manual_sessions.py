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

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from gym_control import anomalies, employees, journal, reports
from gym_control import auth
from gym_control.auth import Admin, require_admin
from gym_control.clocktime import local_iso, parse_local
from gym_control.db import get_db
from gym_control.templates import templates

router = APIRouter(prefix="/admin", dependencies=[Depends(auth.require_same_origin)])

METHOD_MANUAL = "manual"
KIND = "manual_session"


class InvalidManualSession(ValueError):
    """Mesajul (în română) este afișat Adminului."""


def _reason(raw: str) -> str:
    reason = " ".join((raw or "").split())
    if not reason:
        raise InvalidManualSession("Motivul este obligatoriu. Spune de ce se introduce manual această Sesiune.")
    return reason


def _check_interval(db, tz, now, employee_id, entry: datetime, exit_: datetime, ignore_id=None):
    if exit_ <= entry:
        raise InvalidManualSession("Ieșirea trebuie să fie după Intrare.")
    if exit_ > now:
        raise InvalidManualSession("Ieșirea nu poate fi în viitor.")
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
            "Alege un interval care nu se suprapune.")


def add_session(db, now, tz, admin: Admin, employee_id: int, raw_entry: str, raw_exit: str,
                raw_reason: str) -> int:
    """Adaugă o Sesiune manuală închisă. Ridică InvalidManualSession; apelantul comite."""
    reason = _reason(raw_reason)
    employee = db.execute("SELECT id, name FROM employees WHERE id = ?", (employee_id,)).fetchone()
    if employee is None:
        raise InvalidManualSession("Angajatul ales nu există.")
    entry = parse_local(raw_entry, "Intrare", tz, reports.InvalidInterval)
    exit_ = parse_local(raw_exit, "Ieșire", tz, reports.InvalidInterval)
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
    exit_ = parse_local(raw_exit, "Ieșire", tz, reports.InvalidInterval)
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


def _page(request, admin, db, status_code=200, **extra):
    ctx = {"admin": admin, "nav": "sessions", "employees": employees.list_all(db),
           "tz": request.app.state.settings.timezone, "error": None, "form": {}, "session": None,
           **extra}
    return templates.TemplateResponse(request, "manual_session.html", ctx, status_code=status_code)


@router.get("/sessions/new", response_class=HTMLResponse)
def new_form(request: Request, employee: str = "", admin: Admin = Depends(require_admin),
             db: sqlite3.Connection = Depends(get_db)):
    return _page(request, admin, db, form={"employee_id": employee})


@router.post("/sessions", response_class=HTMLResponse)
def create(request: Request, employee_id: str = Form(""), entry_at: str = Form(""),
           exit_at: str = Form(""), reason: str = Form(""),
           admin: Admin = Depends(require_admin), db: sqlite3.Connection = Depends(get_db)):
    form = {"employee_id": employee_id, "entry_at": entry_at, "exit_at": exit_at, "reason": reason}
    try:
        if not employee_id.strip().isdigit():
            raise InvalidManualSession("Alege un Angajat.")
        add_session(db, request.app.state.clock(), request.app.state.settings.timezone, admin,
                    int(employee_id), entry_at, exit_at, reason)
    except (InvalidManualSession, reports.InvalidInterval) as exc:
        db.rollback()
        return _page(request, admin, db, 400, error=str(exc), form=form)
    db.commit()
    return RedirectResponse("/admin/jurnal", status_code=303)


@router.get("/sessions/{session_id}/correct", response_class=HTMLResponse)
def correct_form(request: Request, session_id: int, admin: Admin = Depends(require_admin),
                 db: sqlite3.Connection = Depends(get_db)):
    row = open_session_row(db, session_id)
    if row["exit_at"] is not None:
        return _page(request, admin, db, 409, session=row, error="Sesiunea e deja închisă.")
    return _page(request, admin, db, session=row)


@router.post("/sessions/{session_id}/correct", response_class=HTMLResponse)
def correct(request: Request, session_id: int, exit_at: str = Form(""), reason: str = Form(""),
            admin: Admin = Depends(require_admin), db: sqlite3.Connection = Depends(get_db)):
    row = open_session_row(db, session_id)
    if row["exit_at"] is not None:
        return _page(request, admin, db, 409, session=row, error="Sesiunea e deja închisă.")
    try:
        correct_session(db, request.app.state.clock(), request.app.state.settings.timezone,
                        admin, row, exit_at, reason)
    except (InvalidManualSession, reports.InvalidInterval) as exc:
        db.rollback()
        return _page(request, admin, db, 400, session=row, error=str(exc),
                     form={"exit_at": exit_at, "reason": reason})
    db.commit()
    return RedirectResponse("/admin/anomalies", status_code=303)
