"""Kiosk `/door`: telefonul de la ușă, cu token de kiosk, afișează QR-ul TOTP care se reînnoiește la 30 s.

Tokenul de kiosk (Settings.kiosk_token) se setează o singură dată pe telefon prin `/door?k=<token>`
(devine cookie). `qr_url` construiește URL-ul din QR (`/me?t=<TOTP>`).
"""

import hmac
import io

import segno
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from gym_control import totp
from gym_control.templates import templates

router = APIRouter()
COOKIE = "gym_kiosk"


def _token_ok(request: Request, candidate: str | None) -> bool:
    expected = request.app.state.settings.kiosk_token
    return bool(expected) and bool(candidate) and hmac.compare_digest(candidate.encode(), expected.encode())


def require_kiosk(request: Request) -> None:
    if not _token_ok(request, request.cookies.get(COOKIE)):
        raise HTTPException(status_code=403, detail="Acest telefon nu este configurat ca kiosk.")


def qr_url(request: Request) -> str:
    code = totp.code_at(request.app.state.totp_secret, request.app.state.clock())
    return f"{str(request.base_url).rstrip('/')}/me?t={code}"


def _qr_context(request: Request) -> dict:
    url = qr_url(request)
    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="svg", scale=8, border=2, xmldecl=False, svgns=True)
    return {"qr_url": url, "svg": buf.getvalue().decode()}


@router.get("/door", response_class=HTMLResponse)
def door(request: Request, k: str | None = None):
    if k is not None:
        if not _token_ok(request, k):
            raise HTTPException(status_code=403, detail="Token de kiosk invalid.")
        resp = RedirectResponse("/door", status_code=303)
        resp.set_cookie(COOKIE, k, max_age=10 * 365 * 86400, httponly=True, samesite="strict")
        return resp
    require_kiosk(request)
    return templates.TemplateResponse(request, "door.html", _qr_context(request))


@router.get("/door/qr", response_class=HTMLResponse)
def door_qr(request: Request):
    require_kiosk(request)
    return templates.TemplateResponse(request, "door_qr.html", _qr_context(request))
