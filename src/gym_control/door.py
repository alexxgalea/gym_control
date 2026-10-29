"""Ecranul de la ușă: telefonul de la ușă afișează QR-ul TOTP care se reînnoiește la 30 s.

`/door` servește punctul de intrare Angajat; codul vine din `/api/employee/door/qr` (JSON).
Tokenul Ecranului de la ușă (Settings.kiosk_token) se setează o singură dată pe telefon prin `/door?k=<token>`
(devine cookie, apoi redirecționare la `/door`). `qr_url` construiește URL-ul din QR (`/me?t=<TOTP>`).
"""

import hmac
import io

import segno
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from gym_control import employee_errors, spa, totp

router = APIRouter()
COOKIE = "gym_kiosk"


def _token_ok(request: Request, candidate: str | None) -> bool:
    expected = request.app.state.settings.kiosk_token
    return bool(expected) and bool(candidate) and hmac.compare_digest(candidate.encode(), expected.encode())


def qr_url(request: Request) -> str:
    code = totp.code_at(request.app.state.totp_secret, request.app.state.clock())
    return f"{str(request.base_url).rstrip('/')}/me?t={code}"


def qr_svg(text: str) -> str:
    """Codul QR al unui text, ca SVG (folosit și la Activare telefon). Negru pe alb, cu margine liniștită."""
    buf = io.BytesIO()
    segno.make(text, error="m").save(buf, kind="svg", scale=8, border=2, xmldecl=False, svgns=True)
    return buf.getvalue().decode()


@router.get("/door", include_in_schema=False)
def door(request: Request, k: str | None = None):
    if k is not None:
        if not _token_ok(request, k):
            return spa.employee_entry(request, status_code=403)  # pagina explicativă (interfața vede `?k=`)
        resp = RedirectResponse("/door", status_code=303)
        resp.set_cookie(COOKIE, k, max_age=10 * 365 * 86400, httponly=True, samesite="strict")
        return resp
    return spa.employee_entry(request)


class DoorCode(BaseModel):
    svg: str  # codul QR, negru pe alb
    url: str  # ce conține QR-ul: `/me?t=<cod>`
    period_seconds: int  # cât ține un cod
    remaining_seconds: int  # cât mai e valabil acesta, după ceasul serverului


@router.get("/api/employee/door/qr", response_model=DoorCode, tags=["employee"], responses={
    403: {"description": "Telefon neconfigurat (`door_not_configured`) sau token greșit (`door_token_invalid`)"}})
def door_qr(request: Request):
    cookie = request.cookies.get(COOKIE)
    if not request.app.state.settings.kiosk_token or not cookie:
        return employee_errors.employee_error(
            403, employee_errors.DOOR_NOT_CONFIGURED,
            "Acest telefon nu este configurat ca Ecran de la ușă. Deschide linkul de configurare primit de la Admin.")
    if not _token_ok(request, cookie):
        return employee_errors.employee_error(
            403, employee_errors.DOOR_TOKEN_INVALID,
            "Tokenul Ecranului de la ușă nu mai e valabil. Deschide din nou linkul de configurare primit de la Admin.")
    now = request.app.state.clock()
    url = qr_url(request)
    return DoorCode(svg=qr_svg(url), url=url, period_seconds=totp.STEP_SECONDS,
                    remaining_seconds=totp.STEP_SECONDS - int(now.timestamp()) % totp.STEP_SECONDS)
