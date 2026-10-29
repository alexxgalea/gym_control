"""Angajații: acces la tabel, validare și import CSV."""

import csv
import io
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class InvalidEmployee(ValueError):
    """Mesajul (în română) este afișat Adminului."""


@dataclass
class ImportResult:
    created: int = 0
    errors: list[str] = field(default_factory=list)


def list_all(db: sqlite3.Connection) -> list[sqlite3.Row]:
    return db.execute("SELECT id, name, email FROM employees ORDER BY name, id").fetchall()


def add(db: sqlite3.Connection, now: datetime, name: str, email: str) -> int:
    """Inserează un Angajat (fără commit). Ridică InvalidEmployee dacă datele nu sunt valide."""
    name = " ".join(name.split())
    email = email.strip().lower()
    if not name:
        raise InvalidEmployee("numele lipsește")
    if not _EMAIL.match(email):
        raise InvalidEmployee("email invalid")
    try:
        cur = db.execute(
            "INSERT INTO employees (name, email, created_at) VALUES (?,?,?)",
            (name, email, now.isoformat()),
        )
    except sqlite3.IntegrityError:
        raise InvalidEmployee("email deja existent") from None
    return cur.lastrowid


def parse_csv(raw: bytes):
    """Generează (număr_rând, [celule]) pentru rândurile de date; ridică ValueError la antet greșit."""
    text = raw.decode("utf-8-sig", errors="replace")
    first = text.split("\n", 1)[0]
    delimiter = ";" if first.count(";") > first.count(",") else ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    header = next(reader, None)
    if header is None or [h.strip().lower() for h in header] != ["nume", "email"]:
        raise ValueError("Lipsește antetul „nume,email” pe primul rând.")
    for row in reader:
        if row:
            yield reader.line_num, row
