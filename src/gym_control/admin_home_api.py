"""API-ul paginii de gestiune a Adminului: „Acum în Sală”."""

import sqlite3

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from gym_control import auth, presence
from gym_control.admin_common import UNAUTHORIZED
from gym_control.auth import Admin, require_admin_api
from gym_control.clocktime import local_iso
from gym_control.db import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(auth.require_same_origin)])


class InHallPerson(BaseModel):
    """`entry_at` e în ora locală a Sălii (`AAAA-LL-ZZ HH:MM`); `minutes` e durata de la Intrare, după ceasul serverului."""

    session_id: int
    employee_name: str
    entry_at: str
    minutes: int


class InHallOut(BaseModel):
    people: list[InHallPerson]
    timezone: str


@router.get("/in-hall", response_model=InHallOut, responses=UNAUTHORIZED)
def in_hall(request: Request, admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db)):
    now = request.app.state.clock()
    tz = request.app.state.settings.timezone
    return InHallOut(
        people=[
            InHallPerson(
                session_id=p.session_id, employee_name=p.employee_name, entry_at=local_iso(p.entry_at, tz),
                minutes=max(0, int((now - p.entry_at).total_seconds() // 60)),
            )
            for p in presence.inside_today(db, now, tz)
        ],
        timezone=tz,
    )
