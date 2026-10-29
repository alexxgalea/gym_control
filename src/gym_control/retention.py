"""Retenția: jobul `purge_job(app, now)` (în `scheduler.JOBS`) șterge datele vechi.

Ce se șterge (cutoff = `now` minus `retention_months` luni calendaristice):
- Sesiunile al căror sfârșit (Ieșirea; pentru o Sesiune deschisă, Intrarea) e înainte de cutoff,
  împreună cu Anomaliile lor (`session_anomalies`);
- rândurile din Jurnal (orice fel, inclusiv acțiuni Admin) cu `at` înainte de cutoff.
Ce NU se șterge: Angajații, conturile Admin, setările, Incidentele (metadate mici).
Excepții:
- orice rând (Sesiune sau Jurnal) care se suprapune cu intervalul unui Incident DESCHIS; după
  închiderea Incidentului datele reintră în retenția normală (următorul `tick` le șterge);
- o Sesiune care traversează cutoff-ul (Ieșirea după cutoff) rămâne, iar rândurile de Jurnal ale
  Intrării/Ieșirii ei rămân și ele (sunt referite de Sesiune).
Idempotent; își comite singur munca. Scrie în Jurnal (fără autor) doar dacă a șters ceva.
"""

import calendar
import sqlite3
from datetime import datetime

from gym_control import journal, runtime_settings

# Sesiuni vechi și neprotejate. Protejat = suprapunere (capete incluse) cu un Incident deschis.
_OLD_SESSIONS = (
    "SELECT s.id FROM sessions s WHERE COALESCE(s.exit_at, s.entry_at) < :cutoff"
    " AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.closed_at IS NULL"
    "   AND s.entry_at <= i.end_at AND COALESCE(s.exit_at, s.entry_at) >= i.start_at)"
)


def cutoff_for(now: datetime, months: int) -> datetime:
    """`now` minus `months` luni calendaristice (ziua se limitează la ultima zi a lunii)."""
    year, month0 = divmod(now.year * 12 + (now.month - 1) - months, 12)
    month = month0 + 1
    day = min(now.day, calendar.monthrange(year, month)[1])
    return now.replace(year=year, month=month, day=day)


def purge(db: sqlite3.Connection, now: datetime, months: int) -> tuple[int, int]:
    """Șterge datele vechi; întoarce (Sesiuni șterse, rânduri de Jurnal șterse). Fără commit."""
    args = {"cutoff": cutoff_for(now, months).isoformat()}
    db.execute(f"DELETE FROM session_anomalies WHERE session_id IN ({_OLD_SESSIONS})", args)
    sessions = db.execute(f"DELETE FROM sessions WHERE id IN ({_OLD_SESSIONS})", args).rowcount
    rows = db.execute(
        "DELETE FROM journal WHERE at < :cutoff"
        " AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.closed_at IS NULL"
        "   AND journal.at >= i.start_at AND journal.at <= i.end_at)"
        " AND id NOT IN (SELECT entry_journal_id FROM sessions WHERE entry_journal_id IS NOT NULL)"
        " AND id NOT IN (SELECT exit_journal_id FROM sessions WHERE exit_journal_id IS NOT NULL)",
        args,
    ).rowcount
    if sessions or rows:
        journal.write(
            db, now, kind="retention", action="retention.purge",
            summary=f"Retenție: șterse {sessions} Sesiuni și {rows} rânduri din Jurnal "
                    f"mai vechi de {months} luni",
            detail={"sessions": sessions, "journal_rows": rows, "months": months,
                    "cutoff": args["cutoff"]},
        )
    return sessions, rows


def purge_job(app, now: datetime) -> None:
    with app.state.db_lock:
        db: sqlite3.Connection = app.state.db
        months = runtime_settings.current(db, app.state.settings).retention_months
        purge(db, now, months)
        db.commit()
