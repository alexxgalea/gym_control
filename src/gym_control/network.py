"""Validarea de rețea: cererea trebuie să vină din subrețeaua Sălii.

Dependență reutilizabilă: `dependencies=[Depends(require_hall_network)]` pe o rută.
Subrețeaua se citește la fiecare cerere din setările de runtime.
"""

import ipaddress
import sqlite3

from fastapi import Depends, Request

from gym_control import runtime_settings
from gym_control.db import get_db
from gym_control.templates import templates


class NotInHallNetwork(Exception):
    """Cererea vine din afara subrețelei Sălii."""


def in_subnet(ip: str, subnet: str) -> bool:
    try:
        return ipaddress.ip_address(ip) in ipaddress.ip_network(subnet, strict=False)
    except ValueError:
        return False


def source_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def in_hall(request: Request, db: sqlite3.Connection) -> bool:
    subnet = runtime_settings.current(db, request.app.state.settings).hall_subnet
    return in_subnet(source_ip(request), subnet)


def require_hall_network(request: Request, db: sqlite3.Connection = Depends(get_db)) -> None:
    if not in_hall(request, db):
        raise NotInHallNetwork()


def not_in_hall_handler(request: Request, exc: NotInHallNetwork):
    return templates.TemplateResponse(request, "network_rejected.html", {}, status_code=403)
