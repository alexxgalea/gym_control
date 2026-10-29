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
-- Înrolarea: un link cu folosire unică per emitere; un singur dispozitiv activ per Angajat.
-- Se păstrează doar hash-ul tokenurilor.
CREATE TABLE IF NOT EXISTS enroll_links (
    token_hash TEXT PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT                   -- NULL = încă nefolosit
);
CREATE TABLE IF NOT EXISTS devices (
    token_hash TEXT PRIMARY KEY,   -- hash-ul cookie-ului de dispozitiv
    employee_id INTEGER NOT NULL UNIQUE REFERENCES employees(id),
    enrolled_at TEXT NOT NULL
);
-- Sesiunea: o Intrare și (opțional) Ieșirea ei. Deschisă = exit_at IS NULL.
-- Orele sunt UTC (ISO 8601, aceeași formă ca în Jurnal).
-- Invariant (în cod, `presence`): cel mult o Sesiune deschisă fără Anomalia `missing_exit`;
-- o Sesiune veche rămasă deschisă e marcată Anomalie și nu mai blochează Intrarea.
-- Tichetele următoare adaugă coloane/tabele (Anomalii pe Sesiune, ș.a.).
-- Raportul de prezență: suprapunere = entry_at < Y AND (exit_at IS NULL OR exit_at > X).
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    entry_at TEXT NOT NULL,
    exit_at TEXT,
    entry_method TEXT NOT NULL,    -- metoda de validare: 'none' (#5), 'qr_totp' (#6/#7), 'manual' (#12)
    exit_method TEXT,
    is_manual INTEGER NOT NULL DEFAULT 0,   -- Sesiune manuală (#12)
    manual_reason TEXT,
    entry_journal_id INTEGER REFERENCES journal(id),
    exit_journal_id INTEGER REFERENCES journal(id)
);
CREATE INDEX IF NOT EXISTS sessions_employee ON sessions(employee_id, entry_at);
CREATE INDEX IF NOT EXISTS sessions_entry ON sessions(entry_at);
DROP INDEX IF EXISTS sessions_one_open;   -- înlocuit de invariantul din `presence` (#8)
CREATE INDEX IF NOT EXISTS sessions_open ON sessions(employee_id) WHERE exit_at IS NULL;
-- Anomaliile pe Sesiune (#8; refolosit de #9 open_at_closing, #11, #12 resolved_at).
-- code: 'missing_exit' | 'outside_hours' | 'open_at_closing'; at: UTC; resolved_at NULL = nerezolvată.
CREATE TABLE IF NOT EXISTS session_anomalies (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    code TEXT NOT NULL,
    at TEXT NOT NULL,
    resolved_at TEXT,
    UNIQUE (session_id, code)
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
-- Setările editabile de Admin la runtime (#7); valorile lipsă cad pe configurația din mediu.
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
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
