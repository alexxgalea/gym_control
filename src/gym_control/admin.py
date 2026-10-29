"""Ecranele Admin: autentificare, Angajați, Jurnal."""

import sqlite3
from datetime import date
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from gym_control import anomalies, auth, employees, incidents, journal
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


@router.get("/anomalies", response_class=HTMLResponse)
def anomalies_page(
    request: Request,
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    return templates.TemplateResponse(
        request, "anomalies.html",
        {"admin": admin, "nav": "anomalies", "rows": anomalies.list_unresolved(db),
         "labels": anomalies.LABELS, "tz": request.app.state.settings.timezone},
    )


@router.post("/anomalies/{anomaly_id}/dismiss")
def dismiss_anomaly(
    request: Request,
    anomaly_id: int,
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    row = anomalies.dismiss(db, anomaly_id, now)
    if row is None:
        raise HTTPException(status_code=404, detail="Anomalie inexistentă sau deja rezolvată")
    journal.write_admin_action(
        db, now, admin, "anomaly.dismiss",
        f"Anomalie verificată ({anomalies.LABELS[anomalies.OUTSIDE_HOURS]}): {row['employee_name']}",
        employee_id=row["employee_id"],
        detail={"session_id": row["session_id"], "anomalies": [anomalies.OUTSIDE_HOURS]},
    )
    db.commit()
    return RedirectResponse("/admin/anomalies", status_code=303)


def _incidents_response(request, admin, db, status_code=200, **extra):
    context = {"admin": admin, "nav": "incidents", "rows": incidents.list_all(db),
               "tz": request.app.state.settings.timezone, "form": {}, **extra}
    return templates.TemplateResponse(request, "incidents.html", context, status_code=status_code)


@router.get("/incidents", response_class=HTMLResponse)
def incidents_page(
    request: Request,
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    return _incidents_response(request, admin, db)


@router.post("/incidents")
def create_incident(
    request: Request,
    start: str = Form(""),
    end: str = Form(""),
    note: str = Form(""),
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    try:
        incidents.mark(db, now, request.app.state.settings.timezone, admin, start, end, note)
    except incidents.InvalidIncident as exc:
        db.rollback()
        return _incidents_response(
            request, admin, db, status_code=400, error=str(exc),
            form={"start": start, "end": end, "note": note},
        )
    db.commit()
    return RedirectResponse("/admin/incidents", status_code=303)


@router.post("/incidents/{incident_id}/close")
def close_incident(
    request: Request,
    incident_id: int,
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    if not incidents.close(db, request.app.state.clock(), request.app.state.settings.timezone,
                           admin, incident_id):
        raise HTTPException(status_code=404, detail="Incident inexistent sau deja închis")
    db.commit()
    return RedirectResponse("/admin/incidents", status_code=303)
