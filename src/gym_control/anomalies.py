"""Anomaliile pe Sesiune.

API reutilizabil (#9, #10, #11, #12):
- `flag(db, session_id, code, now)`: marchează idempotent (True dacă a adăugat, False dacă exista);
- `resolve(db, session_id, code, now)`: setează `resolved_at` (#12);
- `list_unresolved(db)`: Anomaliile nerezolvate, cu Angajat și Sesiune, cele mai noi primele;
- `codes_for(db, session_id)`: codurile nerezolvate ale unei Sesiuni;
- `report_codes(db, session_id)`: codurile afișate în Raport (nerezolvate + `outside_hours` verificate);
- `dismiss(db, anomaly_id, now)`: Adminul marchează `outside_hours` ca verificată (doar acest cod);
- `LABELS`: textul afișat pentru fiecare cod.
Nu face commit: apelantul comite cu operația.
"""

import sqlite3
from datetime import datetime

MISSING_EXIT = "missing_exit"
OUTSIDE_HOURS = "outside_hours"
OPEN_AT_CLOSING = "open_at_closing"

LABELS = {
    MISSING_EXIT: "Ieșire lipsă",
    OUTSIDE_HOURS: "Intrare în afara programului",
    OPEN_AT_CLOSING: "Sesiune deschisă la ora de închidere",
}


def flag(db: sqlite3.Connection, session_id: int, code: str, now: datetime) -> bool:
    cur = db.execute(
        "INSERT OR IGNORE INTO session_anomalies (session_id, code, at) VALUES (?,?,?)",
        (session_id, code, now.isoformat()),
    )
    return cur.rowcount > 0


def resolve(db: sqlite3.Connection, session_id: int, code: str, now: datetime) -> None:
    db.execute(
        "UPDATE session_anomalies SET resolved_at = ?"
        " WHERE session_id = ? AND code = ? AND resolved_at IS NULL",
        (now.isoformat(), session_id, code),
    )


def codes_for(db: sqlite3.Connection, session_id: int) -> list[str]:
    return [r["code"] for r in db.execute(
        "SELECT code FROM session_anomalies WHERE session_id = ? AND resolved_at IS NULL ORDER BY id",
        (session_id,))]


def report_codes(db: sqlite3.Connection, session_id: int) -> list[str]:
    """`outside_hours` e o marcă istorică a Intrării: rămâne în Raport și după ce Adminul a verificat-o."""
    return [r["code"] for r in db.execute(
        "SELECT code FROM session_anomalies WHERE session_id = ?"
        " AND (resolved_at IS NULL OR code = ?) ORDER BY id", (session_id, OUTSIDE_HOURS))]


def dismiss(db: sqlite3.Connection, anomaly_id: int, now: datetime) -> sqlite3.Row | None:
    """Rezolvă o Anomalie `outside_hours` nerezolvată. Întoarce rândul (cu Angajatul) sau None.

    Decizie (#4): `outside_hours` nu se rezolvă singură (Intrarea a avut loc oricum în afara programului),
    deci Adminul o poate marca verificată; celelalte coduri se rezolvă prin Ieșire sau corectare."""
    row = db.execute(
        "SELECT a.id, a.session_id, s.employee_id, e.name AS employee_name FROM session_anomalies a"
        " JOIN sessions s ON s.id = a.session_id JOIN employees e ON e.id = s.employee_id"
        " WHERE a.id = ? AND a.code = ? AND a.resolved_at IS NULL", (anomaly_id, OUTSIDE_HOURS)).fetchone()
    if row:
        resolve(db, row["session_id"], OUTSIDE_HOURS, now)
    return row


def list_unresolved(db: sqlite3.Connection) -> list[sqlite3.Row]:
    return db.execute(
        "SELECT a.id, a.session_id, a.code, a.at, s.employee_id, s.entry_at, s.exit_at,"
        " e.name AS employee_name"
        " FROM session_anomalies a JOIN sessions s ON s.id = a.session_id"
        " JOIN employees e ON e.id = s.employee_id"
        " WHERE a.resolved_at IS NULL ORDER BY a.at DESC, a.id DESC"
    ).fetchall()
