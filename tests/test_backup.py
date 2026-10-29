"""Backup zilnic (#14): fișier SQLite restaurabil, rotație 30 de zile, idempotent pe zi."""

import os
import sqlite3
from datetime import timedelta


def _backups(d):
    return sorted(p.name for p in d.glob("gym-control-*.sqlite"))


def _names(path):
    con = sqlite3.connect(path)
    try:
        return [r[0] for r in con.execute("SELECT name FROM employees")]
    finally:
        con.close()


def test_backup_is_a_restorable_sqlite_with_app_data(make_harness, tmp_path):
    h = make_harness(backup_dir=str(tmp_path))
    h.create_employee("Ana Pop")
    h.tick()
    files = _backups(tmp_path)
    assert files == ["gym-control-2026-01-05.sqlite"]
    assert _names(tmp_path / files[0]) == ["Ana Pop"]


def test_same_day_ticks_do_not_recreate(make_harness, tmp_path):
    h = make_harness(backup_dir=str(tmp_path))
    h.create_employee("Ana Pop")
    h.tick()
    h.create_employee("Ion Vasile")
    h.clock.advance(hours=2)
    h.tick()
    assert _backups(tmp_path) == ["gym-control-2026-01-05.sqlite"]
    assert _names(tmp_path / "gym-control-2026-01-05.sqlite") == ["Ana Pop"]
    h.clock.advance(days=1)
    h.tick()
    assert len(_backups(tmp_path)) == 2


def test_old_backups_rotated_unrelated_files_kept(make_harness, tmp_path):
    h = make_harness(backup_dir=str(tmp_path))
    for name in ("gym-control-2025-11-01.sqlite", "gym-control-2025-12-20.sqlite",
                 "notes.txt", "other-2020-01-01.sqlite"):
        (tmp_path / name).write_bytes(b"x")
    h.tick()
    assert _backups(tmp_path) == ["gym-control-2025-12-20.sqlite", "gym-control-2026-01-05.sqlite"]
    assert (tmp_path / "notes.txt").exists()
    assert (tmp_path / "other-2020-01-01.sqlite").exists()


def test_backup_disabled_without_dir(make_harness, tmp_path):
    h = make_harness()
    h.tick()
    assert list(tmp_path.iterdir()) == []


def test_failing_backup_does_not_break_tick(make_harness, tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("x")
    h = make_harness(backup_dir=str(blocker / "dir"))
    h.tick()  # nu aruncă; eroarea e logată
