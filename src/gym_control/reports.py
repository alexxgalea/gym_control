"""Raportul de prezență: cine era în Sală între X și Y.

API reutilizabil (#12 etc.):
- `parse_interval(raw_from, raw_to, tz)` -> (x_utc, y_utc); ridică `InvalidInterval` cu mesaj în română;
- `query(db, tz, closing_time, x, y)` -> `list[ReportRow]`, în ordinea Intrării;
- `csv_bytes(rows, tz)` -> CSV UTF-8 cu BOM, protejat împotriva injecției de formule.

Regula de suprapunere (din schema `sessions`): `entry_at < Y AND (exit_at IS NULL OR exit_at > X)`.
Sesiunile deschise se tratează ca prezente până la ora de închidere a zilei locale a Intrării;
dacă acea oră e deja trecută la momentul Intrării (Intrare după închidere), sunt prezente fără
limită (un nume în plus e preferabil unuia care lipsește). Orice Sesiune din tabel apare,
deci și cele manuale (#12), marcate „Sesiune manuală”.
"""

import csv
import io
import sqlite3
from dataclasses import dataclass
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from gym_control import anomalies, journal
from gym_control.clocktime import local_iso, to_local

DISCLAIMER = (
    "Acest Raport este o listă credibilă de persoane prezente în Sală în interval, "
    "nu o dovadă a vinovăției."
)
OPEN_TEXT = "deschisă"
MANUAL_LABEL = "Sesiune manuală"
CSV_HEADER = ["Angajat", "Intrare", "Ieșire", "Eticheta", "Metoda de validare"]
METHOD_LABELS = {**journal.METHOD_LABELS, "manual": "manuală"}


class InvalidInterval(ValueError):
    pass


def _parse_local(raw: str, name: str, zone: ZoneInfo) -> datetime:
    raw = (raw or "").strip()
    if not raw:
        raise InvalidInterval(f"Completează data și ora pentru „{name}”.")
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=zone).astimezone(timezone.utc)
        except ValueError:
            continue
    raise InvalidInterval(f"Data și ora pentru „{name}” sunt invalide. Folosește formatul AAAA-LL-ZZ HH:MM.")


def parse_interval(raw_from: str, raw_to: str, tz: str) -> tuple[datetime, datetime]:
    zone = ZoneInfo(tz)
    x = _parse_local(raw_from, "De la", zone)
    y = _parse_local(raw_to, "Până la", zone)
    if x >= y:
        raise InvalidInterval("Intervalul e invalid: „De la” trebuie să fie înainte de „Până la”.")
    return x, y


@dataclass
class ReportRow:
    session_id: int
    employee_name: str
    entry_at: datetime
    exit_at: datetime | None
    open: bool
    manual: bool
    label: str
    method_label: str


def _method(code: str | None) -> str:
    return METHOD_LABELS.get(code, str(code)) if code else ""


def _present_until(entry: datetime, tz: str, closing: time) -> datetime | None:
    """Sfârșitul prezenței unei Sesiuni deschise; None = fără limită."""
    local = to_local(entry, tz)
    end = datetime.combine(local.date(), closing, tzinfo=ZoneInfo(tz)).astimezone(timezone.utc)
    return end if end > entry else None


def query(db: sqlite3.Connection, tz: str, closing_time: time,
          x: datetime, y: datetime) -> list[ReportRow]:
    rows = db.execute(
        "SELECT s.*, e.name AS employee_name FROM sessions s"
        " JOIN employees e ON e.id = s.employee_id"
        " WHERE s.entry_at < ? AND (s.exit_at IS NULL OR s.exit_at > ?)"
        " ORDER BY s.entry_at, s.id",
        (y.astimezone(timezone.utc).isoformat(), x.astimezone(timezone.utc).isoformat()),
    ).fetchall()
    result = []
    for r in rows:
        entry = datetime.fromisoformat(r["entry_at"])
        exit_ = datetime.fromisoformat(r["exit_at"]) if r["exit_at"] else None
        if exit_ is None:
            until = _present_until(entry, tz, closing_time)
            if until is not None and until <= x:
                continue
        manual = bool(r["is_manual"]) or r["entry_method"] == "manual"
        labels = []
        if manual:
            labels.append(MANUAL_LABEL + (f" ({r['manual_reason']})" if r["manual_reason"] else ""))
        labels += [anomalies.LABELS.get(c, c) for c in anomalies.codes_for(db, r["id"])]
        methods = [_method(r["entry_method"])]
        if r["exit_method"]:
            methods.append(_method(r["exit_method"]))
        method_label = methods[0] if len(set(methods)) == 1 else f"{methods[0]} / {methods[1]}"
        result.append(ReportRow(
            r["id"], r["employee_name"], entry, exit_, exit_ is None, manual,
            "; ".join(labels), method_label,
        ))
    return result


def _safe(value: str) -> str:
    """Împotriva injecției de formule în Excel/LibreOffice."""
    return "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


def csv_bytes(rows: list[ReportRow], tz: str) -> bytes:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(CSV_HEADER)
    for r in rows:
        w.writerow([
            _safe(r.employee_name), local_iso(r.entry_at, tz),
            local_iso(r.exit_at, tz) if r.exit_at else OPEN_TEXT,
            _safe(r.label), r.method_label,
        ])
    return b"\xef\xbb\xbf" + out.getvalue().encode("utf-8")
