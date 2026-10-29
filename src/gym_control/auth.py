"""Autentificarea Adminului: parolă Argon2, sesiune în cookie (token opac în DB)."""

import hashlib
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request

from gym_control.db import get_db

COOKIE = "gc_admin"
SESSION_TTL = timedelta(hours=12)
_hasher = PasswordHasher()
# hash fals, ca timpul de răspuns să nu trădeze conturile inexistente
_DUMMY_HASH = _hasher.hash("dummy")


@dataclass(frozen=True)
class Admin:
    id: int
    username: str


def create_admin(db: sqlite3.Connection, now: datetime, username: str, password: str) -> None:
    db.execute(
        "INSERT INTO admins (username, password_hash, created_at) VALUES (?,?,?)",
        (username, _hasher.hash(password), now.isoformat()),
    )
    db.commit()


def ensure_bootstrap_admin(db: sqlite3.Connection, now: datetime, username: str, password: str) -> None:
    """Creează primul Admin dacă nu există niciun cont cu acel nume."""
    if not username or not password:
        return
    if db.execute("SELECT 1 FROM admins WHERE username = ?", (username,)).fetchone():
        return
    create_admin(db, now, username, password)


def authenticate(db: sqlite3.Connection, username: str, password: str) -> Admin | None:
    row = db.execute(
        "SELECT id, username, password_hash FROM admins WHERE username = ?", (username,)
    ).fetchone()
    try:
        _hasher.verify(row["password_hash"] if row else _DUMMY_HASH, password)
    except (VerifyMismatchError, InvalidHashError):
        return None
    return Admin(row["id"], row["username"]) if row else None


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def open_session(db: sqlite3.Connection, now: datetime, admin: Admin) -> str:
    token = secrets.token_urlsafe(32)
    db.execute("DELETE FROM admin_sessions WHERE expires_at <= ?", (now.isoformat(),))
    db.execute(
        "INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?,?,?)",
        (_digest(token), admin.id, (now + SESSION_TTL).isoformat()),
    )
    db.commit()
    return token


def close_session(db: sqlite3.Connection, token: str) -> None:
    db.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (_digest(token),))
    db.commit()


def require_admin(request: Request, db: sqlite3.Connection = Depends(get_db)) -> Admin:
    """Dependență pentru orice ecran Admin; fără sesiune valabilă redirecționează la login."""
    token = request.cookies.get(COOKIE)
    now = request.app.state.clock()
    if token:
        row = db.execute(
            "SELECT a.id, a.username FROM admin_sessions s JOIN admins a ON a.id = s.admin_id"
            " WHERE s.token_hash = ? AND s.expires_at > ?",
            (_digest(token), now.isoformat()),
        ).fetchone()
        if row:
            return Admin(row["id"], row["username"])
    raise HTTPException(status_code=303, headers={"Location": "/admin/login"})


def require_same_origin(request: Request) -> None:
    """Protecție CSRF pentru POST-urile Admin: `Origin` (sau, în lipsă, `Referer`) trebuie să fie
    chiar originea aplicației (`Host`-ul cererii). Browserele trimit `Origin` la orice POST; fără
    niciunul dintre antete cererea e refuzată. Se aplică doar metodelor care schimbă starea.
    Alegerea (în locul tokenilor în formulare): fără stare, fără modificări în șabloane; cookie-ul
    Adminului e și `SameSite=Lax`. Aplicația rulează direct, fără proxy (ADR 0001)."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    source = request.headers.get("origin") or request.headers.get("referer") or ""
    host = request.headers.get("host", "")
    if not source or source == "null" or urlsplit(source).netloc != host:
        raise HTTPException(status_code=403, detail="Cerere respinsă: origine necunoscută.")


class LoginThrottle:
    """Limitează încercările de login: după `MAX_FAILURES` eșecuri în `WINDOW` pentru perechea
    (IP, cont), blocare `LOCKOUT`. Ține starea în memorie (se resetează la repornire); ceasul e cel injectat."""

    MAX_FAILURES = 5
    WINDOW = timedelta(minutes=15)
    LOCKOUT = timedelta(minutes=15)

    def __init__(self) -> None:
        self._failures: dict[tuple[str, str], list[datetime]] = {}
        self._locked_until: dict[tuple[str, str], datetime] = {}

    def retry_after(self, key: tuple[str, str], now: datetime) -> timedelta | None:
        until = self._locked_until.get(key)
        if until is not None and until > now:
            return until - now
        self._locked_until.pop(key, None)
        return None

    def record_failure(self, key: tuple[str, str], now: datetime) -> None:
        self._prune(now)
        times = [t for t in self._failures.get(key, []) if now - t < self.WINDOW] + [now]
        self._failures[key] = times
        if len(times) >= self.MAX_FAILURES:
            self._locked_until[key] = now + self.LOCKOUT
            del self._failures[key]

    def record_success(self, key: tuple[str, str]) -> None:
        self._failures.pop(key, None)
        self._locked_until.pop(key, None)

    def _prune(self, now: datetime) -> None:
        self._failures = {k: [t for t in v if now - t < self.WINDOW] for k, v in self._failures.items()}
        self._failures = {k: v for k, v in self._failures.items() if v}
        self._locked_until = {k: v for k, v in self._locked_until.items() if v > now}
