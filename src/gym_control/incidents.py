"""Incidentele: intervale marcate de Admin; datele din ele nu se șterg (retenție) cât sunt deschise.

Orele se introduc în ora locală și se stochează în UTC. `mark`/`close` scriu în Jurnal cu autorul
(fără commit). Retenția (`retention.py`) citește direct tabela `incidents` (closed_at IS NULL).
"""

import sqlite3
from datetime import datetime

from gym_control import journal
from gym_control.auth import Admin
from gym_control.clocktime import local_iso, parse_local

MAX_NOTE = 500


class InvalidIncident(ValueError):
    pass


def mark(db: sqlite3.Connection, now: datetime, tz: str, admin: Admin,
         start: str, end: str, note: str) -> int:
    first, last = parse_local(start, "Începutul", tz, InvalidIncident), parse_local(end, "Sfârșitul", tz, InvalidIncident)
    if first >= last:
        raise InvalidIncident("Începutul trebuie să fie înainte de sfârșit.")
    note = " ".join(note.split())
    if len(note) > MAX_NOTE:
        raise InvalidIncident(f"Nota e prea lungă (maximum {MAX_NOTE} caractere).")
    cur = db.execute(
        "INSERT INTO incidents (start_at, end_at, note, created_at, created_by) VALUES (?,?,?,?,?)",
        (first.isoformat(), last.isoformat(), note, now.isoformat(), admin.username),
    )
    journal.write_admin_action(
        db, now, admin, "incident.mark",
        f"Incident marcat: {local_iso(first, tz)} – {local_iso(last, tz)}" + (f" ({note})" if note else ""),
        detail={"incident_id": cur.lastrowid, "start": first.isoformat(), "end": last.isoformat()},
    )
    return cur.lastrowid


def close(db: sqlite3.Connection, now: datetime, tz: str, admin: Admin, incident_id: int) -> bool:
    """Închide un Incident deschis. False dacă nu există sau e deja închis."""
    row = db.execute("SELECT start_at, end_at FROM incidents WHERE id = ? AND closed_at IS NULL",
                     (incident_id,)).fetchone()
    if row is None:
        return False
    db.execute("UPDATE incidents SET closed_at = ?, closed_by = ? WHERE id = ?",
               (now.isoformat(), admin.username, incident_id))
    journal.write_admin_action(
        db, now, admin, "incident.close",
        f"Incident închis: {local_iso(row['start_at'], tz)} – {local_iso(row['end_at'], tz)}",
        detail={"incident_id": incident_id},
    )
    return True


def list_all(db: sqlite3.Connection) -> list[sqlite3.Row]:
    """Deschise întâi, apoi cele închise; cele mai noi primele."""
    return db.execute(
        "SELECT * FROM incidents ORDER BY closed_at IS NOT NULL, start_at DESC, id DESC"
    ).fetchall()
