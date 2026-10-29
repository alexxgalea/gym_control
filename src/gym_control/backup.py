"""Backup zilnic al bazei SQLite (#14), rulat din `scheduler.tick`.

Copie consistentă prin API-ul de backup SQLite (nu copiere brută de fișier), făcută pe
conexiunea comună, sub `db_lock`. Fișier `gym-control-YYYY-MM-DD.sqlite` (zi locală), cel mult
unul pe zi; apoi se șterg backup-urile mai vechi de `backup_keep_days`, doar fișierele cu
numele de backup. Fără `GYM_BACKUP_DIR` jobul nu face nimic.
"""

import logging
import os
import re
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path

from gym_control.clocktime import local_day

log = logging.getLogger(__name__)

_PATTERN = re.compile(r"^gym-control-(\d{4}-\d{2}-\d{2})\.sqlite$")


def daily_backup(app, now: datetime) -> None:
    settings = app.state.settings
    if not settings.backup_dir:
        return
    directory = Path(settings.backup_dir)
    today = local_day(now, settings.timezone)
    target = directory / f"gym-control-{today.isoformat()}.sqlite"
    if not target.exists():
        directory.mkdir(parents=True, exist_ok=True)
        tmp = directory / f".{target.name}.tmp"
        tmp.unlink(missing_ok=True)
        dest = sqlite3.connect(tmp)
        try:
            with app.state.db_lock:
                app.state.db.backup(dest)
        finally:
            dest.close()
        os.replace(tmp, target)
        log.info("Backup creat: %s", target)
    _rotate(directory, today, settings.backup_keep_days)


def _rotate(directory: Path, today: date, keep_days: int) -> None:
    cutoff = today - timedelta(days=keep_days)
    for p in directory.iterdir():
        m = _PATTERN.match(p.name)
        if m and date.fromisoformat(m.group(1)) < cutoff:
            p.unlink()
            log.info("Backup vechi șters: %s", p)
