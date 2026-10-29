"""Jurnalul. Tichetele următoare adaugă evenimente (Intrare/Ieșire/Anomalie)
și acțiuni Admin prin `write`, fără schimbări de schemă."""

import json
import sqlite3
from datetime import datetime

from gym_control.auth import Admin


def write(
    db: sqlite3.Connection,
    at: datetime,
    *,
    kind: str,
    action: str,
    summary: str,
    author: Admin | None = None,
    employee_id: int | None = None,
    detail: dict | None = None,
) -> None:
    """Adaugă o linie în Jurnal (nu face commit: apelantul comite cu operația)."""
    db.execute(
        "INSERT INTO journal (at, kind, action, summary, author_admin_id,"
        " author_name, employee_id, detail) VALUES (?,?,?,?,?,?,?,?)",
        (
            at.isoformat(),
            kind,
            action,
            summary,
            author.id if author else None,
            author.username if author else None,
            employee_id,
            json.dumps(detail, ensure_ascii=False) if detail else None,
        ),
    )


def write_admin_action(
    db: sqlite3.Connection,
    at: datetime,
    author: Admin,
    action: str,
    summary: str,
    *,
    employee_id: int | None = None,
    detail: dict | None = None,
) -> None:
    write(
        db, at, kind="admin_action", action=action, summary=summary,
        author=author, employee_id=employee_id, detail=detail,
    )


def recent(db: sqlite3.Connection, limit: int = 200) -> list[sqlite3.Row]:
    return db.execute(
        "SELECT j.*, e.name AS employee_name FROM journal j"
        " LEFT JOIN employees e ON e.id = j.employee_id"
        " ORDER BY j.at DESC, j.id DESC LIMIT ?",
        (limit,),
    ).fetchall()
