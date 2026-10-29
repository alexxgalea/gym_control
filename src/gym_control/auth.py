"""Autentificarea Adminului: parolă Argon2, sesiune în cookie (token opac în DB)."""

import hashlib
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta

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
