"""Setările Sălii în API-ul JSON al Adminului (`/api/admin/settings`).

Validarea și Jurnalul stau în `runtime_settings`; aici doar forma JSON. O schimbare se aplică
imediat (setările se citesc la fiecare cerere) și apare în Jurnal cu autorul."""

import ipaddress
import sqlite3

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from gym_control import auth, network, runtime_settings
from gym_control.admin_common import UNAUTHORIZED, field_error
from gym_control.auth import Admin, require_admin_api
from gym_control.db import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(auth.require_same_origin)])


class SettingsOut(BaseModel):
    hall_subnet: str
    opening_time: str
    closing_time: str
    retention_months: int


class SettingsIn(BaseModel):
    """Valori brute din formular (text); validarea o face serverul. Retenția lipsă rămâne neschimbată."""

    hall_subnet: str = ""
    opening_time: str = ""
    closing_time: str = ""
    retention_months: str | None = None


class SettingsFieldError(BaseModel):
    field: str
    detail: str


class SettingsErrorResponse(BaseModel):
    """Toate erorile de validare, lângă câmpul vizat; `detail`/`field` repetă prima eroare."""

    detail: str
    field: str
    errors: list[SettingsFieldError]


class NetworkSuggestion(BaseModel):
    """Sugestia calculată din conexiunea curentă a Adminului. Pentru o adresă fără sugestie, `network` e
    `null`, iar `message` spune pe înțeles de ce. Nu se salvează nimic."""

    address: str
    network: str | None
    message: str | None


def _out(s: runtime_settings.RuntimeSettings) -> SettingsOut:
    return SettingsOut(
        hall_subnet=s.hall_subnet, opening_time=s.opening_time.strftime("%H:%M"),
        closing_time=s.closing_time.strftime("%H:%M"), retention_months=s.retention_months,
    )


@router.get("/settings", response_model=SettingsOut, responses=UNAUTHORIZED)
def get_settings(
    request: Request, admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    return _out(runtime_settings.current(db, request.app.state.settings))


@router.put(
    "/settings", response_model=SettingsOut,
    responses={400: {"model": SettingsErrorResponse}, **UNAUTHORIZED},
)
def save_settings(
    body: SettingsIn, request: Request,
    admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    old = runtime_settings.current(db, request.app.state.settings)
    retention = str(old.retention_months) if body.retention_months is None else body.retention_months
    new, errors = runtime_settings.validate({
        "hall_subnet": body.hall_subnet, "opening_time": body.opening_time,
        "closing_time": body.closing_time, "retention_months": retention,
    })
    if new is None:
        items = [{"field": field, "detail": detail} for field, detail in errors]
        return field_error(db, items[0]["detail"], items[0]["field"], errors=items)
    runtime_settings.save(db, request.app.state.clock(), admin, old, new)
    db.commit()
    return _out(new)


@router.get("/settings/network-suggestion", response_model=NetworkSuggestion, responses=UNAUTHORIZED)
def network_suggestion(request: Request, admin: Admin = Depends(require_admin_api)):
    address = network.source_ip(request)
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        parsed = None
    if isinstance(parsed, ipaddress.IPv4Address):
        net = str(ipaddress.ip_network(f"{address}/24", strict=False))
        return NetworkSuggestion(address=address, network=net, message=None)
    return NetworkSuggestion(
        address=address, network=None,
        message="Nu putem completa rețeaua automat din această conexiune. "
                "Conectează-te la Wi-Fi-ul Sălii și încearcă din nou, sau scrie rețeaua manual.",
    )
