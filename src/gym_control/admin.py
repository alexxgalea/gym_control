"""Ecranele Admin: autentificare, Angajați, Jurnal."""

import sqlite3
from datetime import date
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from gym_control import auth, employees, journal
from gym_control.auth import Admin, require_admin
from gym_control.db import get_db
from gym_control.templates import templates

router = APIRouter(prefix="/admin", dependencies=[Depends(auth.require_same_origin)])


def _parse_day(value: str) -> date | None:
    value = value.strip()
    return date.fromisoformat(value) if value else None


@router.get("/jurnal", response_class=HTMLResponse)
def journal_page(
    request: Request,
    employee: str = "",
    date_from: str = Query("", alias="from"),
    date_to: str = Query("", alias="to"),
    page: str = "1",
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    tz = request.app.state.settings.timezone
    error, result = None, None
    employee_id = int(employee) if employee.strip().isdigit() else None
    try:
        first, last = _parse_day(date_from), _parse_day(date_to)
        if first and last and first > last:
            error = "Intervalul e invers: „De la” trebuie să fie înainte de „Până la”."
        else:
            result = journal.query(
                db, tz, employee_id=employee_id, first=first, last=last,
                page=int(page) if page.isdigit() else 1,
            )
    except ValueError:
        error = "Dată invalidă. Folosește formatul AAAA-LL-ZZ."
    filters = {"employee": employee_id or "", "from": date_from, "to": date_to}
    context = {
        "admin": admin, "nav": "journal", "tz": tz, "error": error, "result": result,
        "employees": employees.list_all(db), "employee_id": employee_id,
        "date_from": date_from, "date_to": date_to,
        "base_query": urlencode({k: v for k, v in filters.items() if v != ""}),
    }
    return templates.TemplateResponse(
        request, "journal.html", context, status_code=400 if error else 200
    )
