"""Intrare/Ieșire: starea Angajatului și Sesiunile (endpointurile JSON sunt în `employee_api`).

API reutilizabil de tichetele următoare:
- `open_session`: starea Angajatului (Sesiune deschisă sau None);
- `is_old`: regula „Sesiune deschisă veche” (#8);
- `record_entry` / `record_exit`: scriu Sesiunea și Jurnalul; întorc None sau mesajul de respingere.
Identitatea vine doar din cookie (`require_employee`).
"""

import sqlite3
from dataclasses import dataclass
from datetime import datetime

from gym_control import anomalies, journal, runtime_settings
from gym_control.clocktime import local_day, local_hm, to_local
from gym_control.enrollment import Employee
from gym_control.settings import Settings

METHOD_NONE = "none"  # fără validare (doar apeluri interne)
METHOD_QR_TOTP = "qr_totp"  # validat prin TOTP-ul din QR (#6)


@dataclass(frozen=True)
class OpenSession:
    id: int
    entry_at: datetime


def open_session(db: sqlite3.Connection, employee_id: int) -> OpenSession | None:
    row = db.execute(
        "SELECT id, entry_at FROM sessions WHERE employee_id = ? AND exit_at IS NULL"
        " AND id NOT IN (SELECT session_id FROM session_anomalies WHERE code = ? AND resolved_at IS NULL)"
        " ORDER BY entry_at DESC, id DESC LIMIT 1",
        (employee_id, anomalies.MISSING_EXIT),
    ).fetchone()
    return OpenSession(row["id"], datetime.fromisoformat(row["entry_at"])) if row else None


def last_event_at(db: sqlite3.Connection, employee_id: int) -> datetime | None:
    """Momentul ultimei Intrări sau Ieșiri a Angajatului (cel mai recent dintre ele)."""
    row = db.execute(
        "SELECT MAX(entry_at) AS entry_at, MAX(exit_at) AS exit_at FROM sessions WHERE employee_id = ?",
        (employee_id,),
    ).fetchone()
    moments = [datetime.fromisoformat(v) for v in (row["entry_at"], row["exit_at"]) if v]
    return max(moments) if moments else None


@dataclass(frozen=True)
class Inside:
    session_id: int
    employee_name: str
    entry_at: datetime


def inside_today(db: sqlite3.Connection, now: datetime, tz: str) -> list[Inside]:
    """„Acum în Sală”: Sesiunile începute în ziua locală de azi, fără Ieșire. Cele vechi nu apar (sunt Anomalii)."""
    rows = db.execute(
        "SELECT s.id, s.entry_at, e.name FROM sessions s JOIN employees e ON e.id = s.employee_id"
        " WHERE s.exit_at IS NULL ORDER BY s.entry_at, s.id",
    ).fetchall()
    today = local_day(now, tz)
    return [
        Inside(r["id"], r["name"], datetime.fromisoformat(r["entry_at"]))
        for r in rows if local_day(r["entry_at"], tz) == today
    ]


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


def _outside_hours(db, now, tz, defaults) -> bool:
    rs = runtime_settings.current(db, defaults)
    t = to_local(now, tz).time()
    return t < rs.opening_time or t >= rs.closing_time


def _flag_missing_exit(db, now, employee, current: OpenSession) -> None:
    if anomalies.flag(db, current.id, anomalies.MISSING_EXIT, now):
        journal.write(
            db, now, kind="anomaly", action="anomaly.missing_exit",
            summary=f"Anomalie ({anomalies.LABELS[anomalies.MISSING_EXIT]}): {employee.name}",
            employee_id=employee.id,
            detail={"session_id": current.id, "anomalies": [anomalies.MISSING_EXIT]},
        )


def record_entry(db: sqlite3.Connection, now: datetime, tz: str, employee: Employee,
                 defaults: Settings, method: str = METHOD_QR_TOTP) -> str | None:
    """Înregistrează Intrarea. Întoarce None la succes sau mesajul de respingere.

    Sesiune deschisă veche: marcată `missing_exit` (nu se închide), Intrarea se acceptă.
    Intrare în afara programului: acceptată, marcată `outside_hours`."""
    current = open_session(db, employee.id)
    if current is not None:
        if not is_old(current, now, tz):
            return f"Ești deja în Sală din {local_hm(current.entry_at, tz)}. Nu poți face o a doua Intrare."
        _flag_missing_exit(db, now, employee, current)
    detail: dict = {"method": method}
    if _outside_hours(db, now, tz, defaults):
        detail["anomalies"] = [anomalies.OUTSIDE_HOURS]
    journal_id = _journal_event(db, now, "entry", employee, detail)
    session_id = db.execute(
        "INSERT INTO sessions (employee_id, entry_at, entry_method, entry_journal_id) VALUES (?,?,?,?)",
        (employee.id, now.isoformat(), method, journal_id),
    ).lastrowid
    for code in detail.get("anomalies", []):
        anomalies.flag(db, session_id, code, now)
    db.commit()
    return None


def record_exit(db: sqlite3.Connection, now: datetime, tz: str, employee: Employee,
                defaults: Settings | None = None, method: str = METHOD_QR_TOTP) -> str | None:
    current = open_session(db, employee.id)
    if current is None:
        return "Nu ai o Intrare deschisă, deci nu poți face Ieșire. Fă mai întâi Intrare."
    if is_old(current, now, tz):
        # Decizie (#8): o Sesiune rămasă deschisă dintr-o zi anterioară este Anomalie `missing_exit`,
        # nu se închide cu ora curentă (ar inventa o prezență peste noapte în Raport). Adminul o corectează.
        _flag_missing_exit(db, now, employee, current)
        db.commit()
        return ("Nu ai o Intrare deschisă azi (ultima Intrare a rămas fără Ieșire). "
                "Adminul poate corecta Sesiunea.")
    journal_id = _journal_event(db, now, "exit", employee, {"method": method, "session_id": current.id})
    db.execute(
        "UPDATE sessions SET exit_at = ?, exit_method = ?, exit_journal_id = ? WHERE id = ?",
        (now.isoformat(), method, journal_id, current.id),
    )
    # Ieșirea normală rezolvă „Sesiune deschisă la închidere” (nu mai e deschisă).
    anomalies.resolve(db, current.id, anomalies.OPEN_AT_CLOSING, now)
    db.commit()
    return None
