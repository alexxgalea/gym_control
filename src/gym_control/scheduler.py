"""Punctul de intrare `tick(app, now)` și schedulerul de producție.

`tick` rulează toate joburile din `JOBS`, sub lock-ul bazei de date. Producția îl apelează
periodic (`run_loop`, pornit din lifespan); testele îl apelează cu ceasul controlat
(`app.state.tick(now)`, vezi `harness.tick()`), cu aceeași cale de cod.

Cum adaugi un job (#13 retenție, #14 backup): scrie `def my_job(app, now) -> None` și adaugă-l
în `JOBS` (o linie). Joburile trebuie să fie idempotente (tick rulează la fiecare minut) și își
comit singure. Un job care aruncă o excepție este logat; celelalte joburi rulează mai departe.
"""

import logging
import sqlite3
import threading
from datetime import datetime
from typing import Callable

from gym_control import anomalies, backup, journal, retention, runtime_settings
from gym_control.clocktime import local_day, to_local

log = logging.getLogger(__name__)

Job = Callable[[object, datetime], None]


def flag_open_sessions_at_closing(app, now: datetime) -> None:
    """La/după ora de închidere locală marchează Sesiunile deschise ca `open_at_closing`.

    Nu închide nimic și nu inventează o oră de Ieșire. Se iau în calcul:
    - Sesiunile deschise azi (zi locală = cea a lui `now`) cu Intrarea înainte de ora de închidere
      (o Intrare după închidere nu era „deschisă la închidere”);
    - Sesiunile mai vechi deja marcate `missing_exit` (nerezolvate): sunt tot deschise.
    Sesiunile vechi nemarcate nu se iau (au fost sau vor fi tratate la Intrarea următoare).
    Idempotent: `anomalies.flag` nu dublează, iar Jurnalul se scrie doar la o marcare nouă.
    """
    tz = app.state.settings.timezone
    with app.state.db_lock:
        db: sqlite3.Connection = app.state.db
        closing = runtime_settings.current(db, app.state.settings).closing_time
        local_now = to_local(now, tz)
        if local_now.time() < closing:
            return
        rows = db.execute(
            "SELECT s.id, s.entry_at, s.employee_id, e.name FROM sessions s"
            " JOIN employees e ON e.id = s.employee_id WHERE s.exit_at IS NULL"
        ).fetchall()
        today = local_day(now, tz)
        missing = {r["session_id"] for r in db.execute(
            "SELECT session_id FROM session_anomalies WHERE code = ? AND resolved_at IS NULL",
            (anomalies.MISSING_EXIT,))}
        changed = False
        for r in rows:
            entry_local = to_local(r["entry_at"], tz)
            counts = (entry_local.date() == today and entry_local.time() < closing) or r["id"] in missing
            if counts and anomalies.flag(db, r["id"], anomalies.OPEN_AT_CLOSING, now):
                journal.write(
                    db, now, kind="anomaly", action="anomaly.open_at_closing",
                    summary=f"Anomalie ({anomalies.LABELS[anomalies.OPEN_AT_CLOSING]}): {r['name']}",
                    employee_id=r["employee_id"],
                    detail={"session_id": r["id"], "anomalies": [anomalies.OPEN_AT_CLOSING]},
                )
                changed = True
        if changed:
            db.commit()


# Registrul joburilor: #13 și #14 își adaugă jobul aici.
JOBS: list[Job] = [flag_open_sessions_at_closing]
JOBS.append(retention.purge_job)  # #13
JOBS.append(backup.daily_backup)


def tick(app, now: datetime) -> None:
    for job in JOBS:
        try:
            job(app, now)
        except Exception:
            log.exception("Jobul %s a eșuat", getattr(job, "__name__", job))
            with app.state.db_lock:
                app.state.db.rollback()


def run_loop(app, stop: threading.Event, interval: float) -> None:
    """Bucla de producție: `tick(clock())` la fiecare `interval` secunde, până la `stop`."""
    while not stop.is_set():
        try:
            tick(app, app.state.clock())
        except Exception:
            log.exception("tick a eșuat")
        stop.wait(interval)
