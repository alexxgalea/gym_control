"""Forma comună a erorilor Angajatului: `{detail, reason}`.

`detail` e mesajul în română, `reason` e un cod stabil după care interfața alege ecranul.
Cererile către API-ul Angajatului (`/api/employee/*`) primesc JSON; paginile vechi (`/me`, `/enroll/*`, `/door`)
primesc în continuare HTML, până la tichetele lor.
"""

from fastapi import Request
from fastapi.responses import JSONResponse

API_PREFIX = "/api/employee/"

NOT_IN_HALL_NETWORK = "not_in_hall_network"
PHONE_NOT_ACTIVATED = "phone_not_activated"


def is_employee_api(request: Request) -> bool:
    return request.url.path.startswith(API_PREFIX)


def employee_error(status_code: int, reason: str, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail, "reason": reason}, status_code=status_code)


def not_in_hall_response() -> JSONResponse:
    return employee_error(
        403, NOT_IN_HALL_NETWORK,
        "Cererea nu vine din rețeaua Sălii. Conectează-te la Wi-Fi-ul Sălii și încearcă din nou.")


def phone_not_activated_response() -> JSONResponse:
    return employee_error(
        401, PHONE_NOT_ACTIVATED,
        "Telefonul tău nu este activat. Cere Adminului un link de activare.")
