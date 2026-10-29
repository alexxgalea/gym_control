"""Jurnalul. Tichetele următoare adaugă evenimente (Intrare/Ieșire/Anomalie)
și acțiuni Admin prin `write`, fără schimbări de schemă."""

import json
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

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


PAGE_SIZE = 50

KIND_LABELS = {"entry": "Intrare", "exit": "Ieșire", "admin_action": "Acțiune Admin",
               "manual_session": "Sesiune manuală"}
METHOD_LABELS = {"none": "Fără validare", "qr_totp": "Cod QR", "manual": "Introdus manual"}


def local_day_bounds(first: date | None, last: date | None, tz: str) -> tuple[str | None, str | None]:
    """Interval de zile locale, inclusiv, în limite UTC `[start, end)` ca text ISO.

    Capătul de sus este începutul zilei locale următoare, deci zilele de 23/25 h (DST)
    sunt acoperite exact."""
    zone = ZoneInfo(tz)

    def utc(day: date) -> str:
        return datetime.combine(day, time.min, tzinfo=zone).astimezone(timezone.utc).isoformat()

    return (utc(first) if first else None, utc(last + timedelta(days=1)) if last else None)


@dataclass
class Entry:
    row: sqlite3.Row
    kind_label: str
    method_label: str | None
    anomalies: list[str]


@dataclass
class Page:
    entries: list[Entry]
    page: int
    has_next: bool = False
    has_prev: bool = False


def _detail(row) -> dict:
    try:
        value = json.loads(row["detail"]) if row["detail"] else {}
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _anomaly_text(item) -> str:
    if isinstance(item, dict):
        for key in ("label", "summary", "type", "kind"):
            if item.get(key):
                return str(item[key])
        return json.dumps(item, ensure_ascii=False)
    return str(item)


def _entry(row: sqlite3.Row) -> Entry:
    detail = _detail(row)
    method = detail.get("method")
    anomalies = detail.get("anomalies")  # extensie #8/#9: schema o decid tichetele respective
    if not isinstance(anomalies, list):
        anomalies = [anomalies] if anomalies else []
    return Entry(
        row=row,
        kind_label=KIND_LABELS.get(row["kind"], row["kind"]),
        method_label=METHOD_LABELS.get(method, str(method)) if method else None,
        anomalies=[_anomaly_text(a) for a in anomalies],
    )


def query(
    db: sqlite3.Connection,
    tz: str,
    *,
    employee_id: int | None = None,
    first: date | None = None,
    last: date | None = None,
    page: int = 1,
    page_size: int = PAGE_SIZE,
) -> Page:
    """Jurnalul filtrat după Angajat și zile locale (inclusiv), cel mai nou primul, paginat."""
    where, params = [], []
    if employee_id is not None:
        where.append("j.employee_id = ?")
        params.append(employee_id)
    start, end = local_day_bounds(first, last, tz)
    if start:
        where.append("j.at >= ?")
        params.append(start)
    if end:
        where.append("j.at < ?")
        params.append(end)
    page = max(page, 1)
    rows = db.execute(
        "SELECT j.*, e.name AS employee_name FROM journal j"
        " LEFT JOIN employees e ON e.id = j.employee_id"
        + (" WHERE " + " AND ".join(where) if where else "")
        + " ORDER BY j.at DESC, j.id DESC LIMIT ? OFFSET ?",
        (*params, page_size + 1, (page - 1) * page_size),
    ).fetchall()
    return Page([_entry(r) for r in rows[:page_size]], page, len(rows) > page_size, page > 1)
