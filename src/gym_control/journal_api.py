"""API JSON al Jurnalului (`/api/admin/journal`): citire cu filtre (interval, Angajat, tip) și paginare.

Momentele se trimit în UTC (cum sunt stocate) împreună cu fusul Sălii; SPA-ul le afișează în format românesc."""

import sqlite3
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from gym_control import auth, journal
from gym_control.admin_api import ErrorResponse
from gym_control.auth import Admin, require_admin_api
from gym_control.db import get_db

router = APIRouter(prefix="/api/admin/journal", tags=["journal"], dependencies=[Depends(auth.require_same_origin)])

MANUAL_KIND = "manual_session"


class JournalEntryOut(BaseModel):
    id: int
    at: str  # ISO, UTC
    kind: str
    kind_label: str
    employee_id: int | None
    employee_name: str | None
    method_label: str | None
    anomalies: list[str]
    author: str | None
    summary: str
    manual: bool  # Sesiune manuală: marcată vizibil în ecran


class JournalPageOut(BaseModel):
    entries: list[JournalEntryOut]
    page: int
    has_next: bool
    has_prev: bool
    timezone: str


class KindOption(BaseModel):
    value: str
    label: str


def _parse_day(value: str) -> date | None:
    value = value.strip()
    return date.fromisoformat(value) if value else None


@router.get("/kinds", response_model=list[KindOption], responses={401: {"model": ErrorResponse}})
def list_kinds(admin: Admin = Depends(require_admin_api)):
    return [KindOption(value=value, label=label) for value, label in journal.KIND_LABELS.items()]


@router.get(
    "", response_model=JournalPageOut,
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}},
)
def read_journal(
    request: Request,
    employee: str = "",
    date_from: str = Query("", alias="from"),
    date_to: str = Query("", alias="to"),
    kind: str = "",
    page: str = "1",
    admin: Admin = Depends(require_admin_api),
    db: sqlite3.Connection = Depends(get_db),
):
    tz = request.app.state.settings.timezone
    try:
        first, last = _parse_day(date_from), _parse_day(date_to)
    except ValueError:
        raise HTTPException(status_code=400, detail="Dată invalidă. Folosește formatul AAAA-LL-ZZ.")
    if first and last and first > last:
        raise HTTPException(
            status_code=400,
            detail="Intervalul e invers: „De la” trebuie să fie înainte de „Până la”.",
        )
    kind = kind.strip()
    if kind and kind not in journal.KIND_LABELS:
        raise HTTPException(status_code=400, detail="Tip necunoscut.")
    result = journal.query(
        db, tz, employee_id=int(employee) if employee.strip().isdigit() else None,
        first=first, last=last, kind=kind or None, page=int(page) if page.isdigit() else 1,
    )
    return JournalPageOut(
        entries=[
            JournalEntryOut(
                id=e.row["id"], at=e.row["at"], kind=e.row["kind"], kind_label=e.kind_label,
                employee_id=e.row["employee_id"], employee_name=e.row["employee_name"],
                method_label=e.method_label, anomalies=e.anomalies, author=e.row["author_name"],
                summary=e.row["summary"], manual=e.row["kind"] == MANUAL_KIND,
            )
            for e in result.entries
        ],
        page=result.page, has_next=result.has_next, has_prev=result.has_prev, timezone=tz,
    )
