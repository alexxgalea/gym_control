"""Înrolarea dispozitivului: link cu folosire unică -> cookie de lungă durată.

Identitatea Angajatului vine EXCLUSIV din cookie-ul de dispozitiv (token opac,
păstrat hash-uit). Tichetele următoare folosesc `require_employee`.
"""

import hashlib
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from gym_control import employee_errors, journal
from gym_control.db import get_db
from gym_control.network import require_hall_network
from gym_control.templates import templates

COOKIE = "gc_device"
LINK_TTL = timedelta(hours=48)
COOKIE_MAX_AGE = 2 * 365 * 24 * 3600

router = APIRouter()


@dataclass(frozen=True)
class Employee:
    id: int
    name: str


class EnrollmentRequired(Exception):
    """Cererea nu vine de la un dispozitiv înrolat."""


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_link(db: sqlite3.Connection, now: datetime, employee_id: int) -> str:
    """Emite un link nou; linkurile nefolosite anterioare ale Angajatului devin nule (fără commit)."""
    db.execute("DELETE FROM enroll_links WHERE employee_id = ? AND used_at IS NULL", (employee_id,))
    db.execute("DELETE FROM enroll_links WHERE expires_at <= ?", (now.isoformat(),))
    token = secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO enroll_links (token_hash, employee_id, created_at, expires_at) VALUES (?,?,?,?)",
        (_digest(token), employee_id, now.isoformat(), (now + LINK_TTL).isoformat()),
    )
    return token


def revoke(db: sqlite3.Connection, employee_id: int) -> None:
    """Revocă dispozitivul și linkurile nefolosite (fără commit)."""
    db.execute("DELETE FROM devices WHERE employee_id = ?", (employee_id,))
    db.execute("DELETE FROM enroll_links WHERE employee_id = ? AND used_at IS NULL", (employee_id,))


def enrolled_ids(db: sqlite3.Connection) -> set[int]:
    return {r["employee_id"] for r in db.execute("SELECT employee_id FROM devices")}


def _open_link(db, now, token):
    return db.execute(
        "SELECT l.employee_id, e.name FROM enroll_links l JOIN employees e ON e.id = l.employee_id"
        " WHERE l.token_hash = ? AND l.used_at IS NULL AND l.expires_at > ?",
        (_digest(token), now.isoformat()),
    ).fetchone()


def current_employee(request: Request, db: sqlite3.Connection = Depends(get_db)) -> Employee | None:
    """Dependență: Angajatul identificat de cookie sau None."""
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    row = db.execute(
        "SELECT e.id, e.name FROM devices d JOIN employees e ON e.id = d.employee_id"
        " WHERE d.token_hash = ?",
        (_digest(token),),
    ).fetchone()
    return Employee(row["id"], row["name"]) if row else None


def require_employee(employee: Employee | None = Depends(current_employee)) -> Employee:
    """Dependență pentru ecranele Angajatului: fără dispozitiv înrolat se afișează mesajul de înrolare."""
    if employee is None:
        raise EnrollmentRequired()
    return employee


def enrollment_required_handler(request: Request, exc: EnrollmentRequired):
    if employee_errors.is_employee_api(request):
        return employee_errors.phone_not_activated_response()
    return templates.TemplateResponse(request, "enroll_required.html", {}, status_code=401)


def _invalid(request):
    return templates.TemplateResponse(request, "enroll_invalid.html", {}, status_code=410)


@router.get("/enroll/{token}", response_class=HTMLResponse)
def enroll_page(request: Request, token: str, db: sqlite3.Connection = Depends(get_db)):
    link = _open_link(db, request.app.state.clock(), token)
    if link is None:
        return _invalid(request)
    return templates.TemplateResponse(request, "enroll_confirm.html", {"name": link["name"]})


@router.post("/enroll/{token}", dependencies=[Depends(require_hall_network)])
def enroll(request: Request, token: str, db: sqlite3.Connection = Depends(get_db)):
    now = request.app.state.clock()
    link = _open_link(db, now, token)
    if link is None:
        return _invalid(request)
    employee_id = link["employee_id"]
    device_token = secrets.token_urlsafe(32)
    db.execute("UPDATE enroll_links SET used_at = ? WHERE token_hash = ?", (now.isoformat(), _digest(token)))
    db.execute("DELETE FROM devices WHERE employee_id = ?", (employee_id,))
    db.execute(
        "INSERT INTO devices (token_hash, employee_id, enrolled_at) VALUES (?,?,?)",
        (_digest(device_token), employee_id, now.isoformat()),
    )
    journal.write(
        db, now, kind="enrollment", action="enroll.device",
        summary=f"Dispozitiv înrolat: {link['name']}", employee_id=employee_id,
    )
    db.commit()
    response = RedirectResponse("/me", status_code=303)
    response.set_cookie(COOKIE, device_token, httponly=True, samesite="lax", max_age=COOKIE_MAX_AGE)
    return response

