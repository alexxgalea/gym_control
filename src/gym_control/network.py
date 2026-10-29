"""Validarea de rețea: cererea trebuie să vină din subrețeaua Sălii.

Dependență reutilizabilă: `dependencies=[Depends(require_hall_network)]` pe o rută.
Subrețeaua se citește la fiecare cerere din setările de runtime.
"""

import ipaddress
import sqlite3

from fastapi import Depends, Request

from gym_control import employee_errors, runtime_settings
from gym_control.db import get_db


class NotInHallNetwork(Exception):
    """Cererea vine din afara subrețelei Sălii."""


def in_subnet(ip: str, subnet: str) -> bool:
    try:
        return ipaddress.ip_address(ip) in ipaddress.ip_network(subnet, strict=False)
    except ValueError:
        return False


def _trusted(ip: str, proxies: tuple[str, ...]) -> bool:
    return any(in_subnet(ip, p) for p in proxies)


def source_ip(request: Request) -> str:
    """Adresa sursă a cererii: cea a conexiunii TCP.

    `X-Forwarded-For` se ia în calcul doar dacă conexiunea vine de la un proxy din `GYM_TRUSTED_PROXIES`
    (implicit niciunul). Lanțul se parcurge de la dreapta, sărind peste proxy-urile de încredere; prima adresă
    necunoscută e clientul. Antetul trimis de client în stânga lanțului nu poate falsifica rezultatul."""
    peer = request.client.host if request.client else ""
    proxies = request.app.state.settings.trusted_proxies
    if not proxies or not _trusted(peer, proxies):
        return peer
    chain = [a.strip() for a in request.headers.get("x-forwarded-for", "").split(",") if a.strip()]
    for addr in reversed(chain):
        if not _trusted(addr, proxies):
            return addr
    return peer


def in_hall(request: Request, db: sqlite3.Connection) -> bool:
    subnet = runtime_settings.current(db, request.app.state.settings).hall_subnet
    return in_subnet(source_ip(request), subnet)


def require_hall_network(request: Request, db: sqlite3.Connection = Depends(get_db)) -> None:
    if not in_hall(request, db):
        raise NotInHallNetwork()


def not_in_hall_handler(request: Request, exc: NotInHallNetwork):
    return employee_errors.not_in_hall_response()
