"""API-ul JSON al Angajatului (`/api/employee/*`), servit punctului de intrare Angajat al frontend-ului."""

import sqlite3

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from gym_control import network
from gym_control.db import get_db

router = APIRouter(prefix="/api/employee", tags=["employee"])


class ConnectionStatus(BaseModel):
    in_hall: bool
    server_time: str  # ISO 8601, UTC; interfața o formatează în ora Sălii
    time_zone: str  # fusul Sălii (IANA)


@router.get("/status", response_model=ConnectionStatus)
def connection_status(request: Request, db: sqlite3.Connection = Depends(get_db)) -> ConnectionStatus:
    """Verificare conexiune: dacă cererea e în rețeaua Sălii și ora serverului. Nu cere rețeaua Sălii."""
    return ConnectionStatus(
        in_hall=network.in_hall(request, db),
        server_time=request.app.state.clock().isoformat(),
        time_zone=request.app.state.settings.timezone,
    )
