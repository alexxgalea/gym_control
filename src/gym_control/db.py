"""Schema SQLite și acces la conexiune. Singura sursă a structurii tabelelor."""

import sqlite3
import threading
from typing import Iterator

from fastapi import Request

SCHEMA = """
CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id),
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,   -- normalizat: litere mici
    created_at TEXT NOT NULL
);
-- Jurnalul: un singur tabel pentru Intrări, Ieșiri, Anomalii și acțiuni Admin.
-- kind: 'admin_action' | 'entry' | 'exit' | 'anomaly' | ... (tichetele următoare)
CREATE TABLE IF NOT EXISTS journal (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,              -- UTC, ISO 8601
    kind TEXT NOT NULL,
    action TEXT NOT NULL,          -- cod scurt, ex. 'employee.create'
    summary TEXT NOT NULL,         -- text afișat în Jurnal
    author_admin_id INTEGER REFERENCES admins(id),
    author_name TEXT,              -- numele autorului, păstrat la momentul acțiunii
    employee_id INTEGER REFERENCES employees(id),
    detail TEXT                    -- JSON opțional
);
CREATE INDEX IF NOT EXISTS journal_at ON journal(at);
CREATE INDEX IF NOT EXISTS journal_employee ON journal(employee_id, at);
"""


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn


def get_db(request: Request) -> Iterator[sqlite3.Connection]:
    """Dependență FastAPI: conexiunea unică, serializată printr-un lock."""
    lock: threading.RLock = request.app.state.db_lock
    with lock:
        yield request.app.state.db
