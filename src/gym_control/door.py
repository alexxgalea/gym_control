"""Ecranul de la ușă: telefonul de la ușă afișează QR-ul TOTP care se reînnoiește la 30 s.

Activare Ecran de la ușă (ADR 0004): Adminul emite un link de unică folosință (48 h); pe telefonul de la ușă
linkul arată o confirmare (nu se consumă), iar butonul îl consumă și pune cookie-ul telefonului. Un singur
Ecran de la ușă e activ; starea stă în baza de date (hash-ul cookie-ului), deci supraviețuiește repornirii.
`/door` servește punctul de intrare Angajat; codul vine din `/api/employee/door/qr` (JSON), doar pentru
telefonul activat. `qr_url` construiește URL-ul din QR (`/me?t=<TOTP>`).
"""

import hashlib
import hmac
import io
import secrets
import sqlite3
from datetime import datetime, timedelta

import segno
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from gym_control import employee_errors, journal, spa, totp
from gym_control.auth import Admin
from gym_control.db import get_db
from gym_control.network import require_hall_network

router = APIRouter()
COOKIE = "gc_door"
LINK_TTL = timedelta(hours=48)
COOKIE_MAX_AGE = 10 * 365 * 86400


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_link(db: sqlite3.Connection, now: datetime, admin: Admin) -> str:
    """Emite un link nou de Activare; linkurile nefolosite anterioare devin nule (fără commit)."""
    db.execute("DELETE FROM door_links WHERE used_at IS NULL OR expires_at <= ?", (now.isoformat(),))
    token = secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO door_links (token_hash, admin_id, created_at, expires_at) VALUES (?,?,?,?)",
        (_digest(token), admin.id, now.isoformat(), (now + LINK_TTL).isoformat()),
    )
    return token


def active_since(db: sqlite3.Connection) -> datetime | None:
    row = db.execute("SELECT activated_at FROM door_screen WHERE id = 1").fetchone()
    return datetime.fromisoformat(row["activated_at"]) if row else None


def retire(db: sqlite3.Connection) -> bool:
    """Scoate din uz Ecranul de la ușă activ și anulează linkurile de Activare nefolosite (fără commit);
    False dacă nu era niciun Ecran activ."""
    retired = db.execute("DELETE FROM door_screen WHERE id = 1").rowcount > 0
    if retired:
        db.execute("DELETE FROM door_links WHERE used_at IS NULL")
    return retired


def _open_link(db, now, token):
    return db.execute(
        "SELECT l.admin_id, a.username FROM door_links l JOIN admins a ON a.id = l.admin_id"
        " WHERE l.token_hash = ? AND l.used_at IS NULL AND l.expires_at > ?",
        (_digest(token), now.isoformat()),
    ).fetchone()


def qr_url(request: Request) -> str:
    code = totp.code_at(request.app.state.totp_secret, request.app.state.clock())
    return f"{str(request.base_url).rstrip('/')}/me?t={code}"


def qr_svg(text: str) -> str:
    """Codul QR al unui text, ca SVG (folosit și la Activare telefon). Negru pe alb, cu margine liniștită."""
    buf = io.BytesIO()
    segno.make(text, error="m").save(buf, kind="svg", scale=8, border=2, xmldecl=False, svgns=True)
    return buf.getvalue().decode()


@router.get("/door", include_in_schema=False)
def door(request: Request):
    return spa.employee_entry(request)


class DoorActivationOut(BaseModel):
    pass


@router.get("/api/employee/door/activate/{token}", response_model=DoorActivationOut,
            tags=["employee"], responses={410: {"description": "link_invalid"}})
def read_activation_link(request: Request, token: str, db: sqlite3.Connection = Depends(get_db)):
    """Confirmarea Activării (nu consumă linkul). Nu cere rețeaua Sălii."""
    if _open_link(db, request.app.state.clock(), token) is None:
        return employee_errors.link_invalid_response()
    return DoorActivationOut()


@router.post("/api/employee/door/activate/{token}", response_model=DoorActivationOut, tags=["employee"],
             dependencies=[Depends(require_hall_network)],
             responses={403: {"description": "not_in_hall_network"}, 410: {"description": "link_invalid"}})
def activate(request: Request, token: str, db: sqlite3.Connection = Depends(get_db)):
    now = request.app.state.clock()
    link = _open_link(db, now, token)
    if link is None:
        return employee_errors.link_invalid_response()
    device_token = secrets.token_urlsafe(32)
    consumed = db.execute(  # atomic: dintre două cereri concurente pe același link, doar una consumă
        "UPDATE door_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
        (now.isoformat(), _digest(token), now.isoformat()),
    )
    if consumed.rowcount == 0:
        db.rollback()
        return employee_errors.link_invalid_response()
    db.execute(
        "INSERT INTO door_screen (id, token_hash, activated_at, activated_by_admin_id) VALUES (1,?,?,?)"
        " ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash,"
        " activated_at = excluded.activated_at, activated_by_admin_id = excluded.activated_by_admin_id",
        (_digest(device_token), now.isoformat(), link["admin_id"]),
    )
    journal.write(
        db, now, kind="admin_action", action="door.activate", summary="Ecranul de la ușă activat",
        author=Admin(link["admin_id"], link["username"]),
    )
    db.commit()
    response = JSONResponse({})
    response.set_cookie(COOKIE, device_token, httponly=True, samesite="strict", max_age=COOKIE_MAX_AGE)
    return response


class DoorCode(BaseModel):
    svg: str  # codul QR, negru pe alb
    url: str  # ce conține QR-ul: `/me?t=<cod>`
    period_seconds: int  # cât ține un cod
    remaining_seconds: int  # cât mai e valabil acesta, după ceasul serverului


@router.get("/api/employee/door/qr", response_model=DoorCode, tags=["employee"], responses={
    403: {"description": "Telefon neactivat (`door_not_configured`) sau înlocuit (`door_token_invalid`)"}})
def door_qr(request: Request, db: sqlite3.Connection = Depends(get_db)):
    cookie = request.cookies.get(COOKIE)
    if not cookie:
        return employee_errors.employee_error(
            403, employee_errors.DOOR_NOT_CONFIGURED,
            "Acest telefon nu este activat ca Ecran de la ușă. Cere Adminului un link de activare.")
    row = db.execute("SELECT token_hash FROM door_screen WHERE id = 1").fetchone()
    if row is None or not hmac.compare_digest(_digest(cookie), row["token_hash"]):
        return employee_errors.employee_error(
            403, employee_errors.DOOR_TOKEN_INVALID,
            "Acest telefon nu mai este Ecranul de la ușă. Cere Adminului un link nou de activare.")
    now = request.app.state.clock()
    url = qr_url(request)
    return DoorCode(svg=qr_svg(url), url=url, period_seconds=totp.STEP_SECONDS,
                    remaining_seconds=totp.STEP_SECONDS - int(now.timestamp()) % totp.STEP_SECONDS)
