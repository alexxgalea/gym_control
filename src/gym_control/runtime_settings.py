"""Setările Sălii editabile la runtime (subrețea, program, ora de închidere).

Valorile stau în tabela `settings`; cât timp nu există o valoare salvată, se
folosește configurația din mediu (`Settings`). Se citesc la fiecare cerere, deci
o schimbare se aplică imediat. Retenția (#13) se adaugă ca un câmp nou aici:
în `LABELS`, în `RuntimeSettings`, în `current` și în `validate`.

API: `current(db, defaults)` -> `RuntimeSettings`; `validate(form)` -> (valori, erori `(câmp, mesaj)`);
`save(db, now, admin, old, new)` scrie valorile și Jurnalul (fără commit).
"""

import ipaddress
import sqlite3
from dataclasses import dataclass, fields
from datetime import datetime, time

from gym_control import journal
from gym_control.auth import Admin
from gym_control.settings import Settings

LABELS = {
    "hall_subnet": "Subrețea",
    "opening_time": "Ora de deschidere",
    "closing_time": "Ora de închidere",
    "retention_months": "Perioada de retenție (luni)",
}


@dataclass(frozen=True)
class RuntimeSettings:
    hall_subnet: str
    opening_time: time
    closing_time: time
    retention_months: int = 12


def _dump(value) -> str:
    return value.strftime("%H:%M") if isinstance(value, time) else str(value)


def current(db: sqlite3.Connection, defaults: Settings) -> RuntimeSettings:
    stored = {r["key"]: r["value"] for r in db.execute("SELECT key, value FROM settings")}
    return RuntimeSettings(
        hall_subnet=stored.get("hall_subnet", defaults.hall_subnet),
        opening_time=time.fromisoformat(stored["opening_time"]) if "opening_time" in stored else defaults.opening_time,
        closing_time=time.fromisoformat(stored["closing_time"]) if "closing_time" in stored else defaults.closing_time,
        retention_months=int(stored.get("retention_months", defaults.retention_months)),
    )


def _parse_time(raw: str) -> time | None:
    parts = raw.strip().split(":")
    if len(parts) != 2 or not all(p.isdigit() and len(p) == 2 for p in parts):
        return None
    try:
        return time(int(parts[0]), int(parts[1]))
    except ValueError:
        return None


def validate(form: dict[str, str]) -> tuple[RuntimeSettings | None, list[tuple[str, str]]]:
    """Erorile sunt perechi `(numele câmpului, mesaj în română)`."""
    errors: list[tuple[str, str]] = []
    subnet = form.get("hall_subnet", "").strip()
    try:
        subnet = str(ipaddress.ip_network(subnet, strict=False))
    except ValueError:
        errors.append(("hall_subnet", "Subrețea invalidă: folosește notația CIDR, de exemplu 192.168.10.0/24."))
    opening = _parse_time(form.get("opening_time", ""))
    if opening is None:
        errors.append(("opening_time", "Ora de deschidere invalidă: folosește formatul HH:MM, de exemplu 06:00."))
    closing = _parse_time(form.get("closing_time", ""))
    if closing is None:
        errors.append(("closing_time", "Ora de închidere invalidă: folosește formatul HH:MM, de exemplu 22:00."))
    if opening and closing and opening >= closing:
        errors.append(("closing_time", "Ora de deschidere trebuie să fie înainte de ora de închidere."))
    months_raw = form.get("retention_months", "").strip()
    months = int(months_raw) if months_raw.isascii() and months_raw.isdigit() else 0
    if months < 1:
        errors.append(("retention_months", "Perioada de retenție invalidă: introdu un număr întreg pozitiv de luni, de exemplu 12."))
    if errors:
        return None, errors
    return RuntimeSettings(subnet, opening, closing, months), []


def save(db: sqlite3.Connection, now: datetime, admin: Admin,
         old: RuntimeSettings, new: RuntimeSettings) -> bool:
    """Scrie valorile schimbate și o linie în Jurnal. Fără schimbări: nu scrie nimic. Fără commit."""
    changes = {}
    for f in fields(RuntimeSettings):
        before, after = _dump(getattr(old, f.name)), _dump(getattr(new, f.name))
        if before != after:
            changes[f.name] = {"from": before, "to": after}
            db.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (f.name, after),
            )
    if not changes:
        return False
    text = "; ".join(f"{LABELS[k]}: {v['from']} → {v['to']}" for k, v in changes.items())
    journal.write_admin_action(
        db, now, admin, "settings.update", f"Setări modificate. {text}", detail=changes,
    )
    return True
