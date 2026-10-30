"""TOTP al QR-ului de la ușă (ADR 0001).

API reutilizabil:
- `code_at(secret, now)`: codul ferestrei de 30 s care conține `now`;
- `check(secret, now, code)`: `OK` / `EXPIRED` / `INVALID` / `MISSING`; `now` vine doar din ceasul serverului;
- `reject_message(result)`: mesajul în română pentru respingere;
- `load_secret(db, configured)`: secretul din Settings, altfel unul generat și păstrat în baza de date.
Nu e de unică folosință: mai mulți Angajați pot folosi același cod în aceeași fereastră.
"""

import hashlib
import hmac
import secrets
import sqlite3
from datetime import datetime

STEP_SECONDS = 30
DIGITS = 8
ACCEPTED_WINDOWS_BACK = 1   # fereastra curentă + cea anterioară
EXPIRED_LOOKBACK = 20       # doar pentru a distinge „expirat” de „greșit”

OK, EXPIRED, INVALID, MISSING = "ok", "expired", "invalid", "missing"


def _window(now: datetime) -> int:
    return int(now.timestamp()) // STEP_SECONDS


def _code(secret: str, window: int) -> str:
    digest = hmac.new(secret.encode(), window.to_bytes(8, "big"), hashlib.sha256).digest()
    offset = digest[-1] & 0x0F
    number = int.from_bytes(digest[offset:offset + 4], "big") & 0x7FFFFFFF
    return str(number % 10**DIGITS).zfill(DIGITS)


def code_at(secret: str, now: datetime) -> str:
    return _code(secret, _window(now))


def check(secret: str, now: datetime, code: str | None) -> str:
    code = (code or "").strip()
    if not code:
        return MISSING
    w = _window(now)
    candidate = code.encode()  # compare_digest pe str refuză non-ASCII (TypeError); comparăm octeți
    if any(hmac.compare_digest(candidate, _code(secret, w - i).encode())
           for i in range(ACCEPTED_WINDOWS_BACK + 1)):
        return OK
    if any(hmac.compare_digest(candidate, _code(secret, w - i).encode())
           for i in range(ACCEPTED_WINDOWS_BACK + 1, EXPIRED_LOOKBACK)):
        return EXPIRED
    return INVALID


def accepted_window(secret: str, now: datetime, code: str | None) -> int | None:
    """Fereastra de 30 s căreia îi aparține codul acceptat (curentă sau anterioară), altfel None."""
    candidate = (code or "").strip().encode()
    w = _window(now)
    for i in range(ACCEPTED_WINDOWS_BACK + 1):
        if hmac.compare_digest(candidate, _code(secret, w - i).encode()):
            return w - i
    return None


def window_of(moment: datetime) -> int:
    return _window(moment)


def reject_message(result: str) -> str:
    if result == EXPIRED:
        return "Codul QR a expirat. Scanează din nou QR-ul de la ușă."
    return "Scanează QR-ul de la ușă pentru a face Intrare sau Ieșire (cod lipsă sau greșit)."


def load_secret(db: sqlite3.Connection, configured: str) -> str:
    if configured:
        return configured
    db.execute("CREATE TABLE IF NOT EXISTS app_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)")
    row = db.execute("SELECT value FROM app_secrets WHERE name = 'totp'").fetchone()
    if row:
        return row["value"]
    value = secrets.token_hex(32)
    db.execute("INSERT INTO app_secrets (name, value) VALUES ('totp', ?)", (value,))
    db.commit()
    return value
