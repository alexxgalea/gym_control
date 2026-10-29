"""API JSON al Raportului de prezență: `/api/admin/reports` (ecran și variantă tipărită) și
`/api/admin/reports.csv` (descărcare). Logica (interval, interogare, CSV) e în `reports.py`.

Orice Raport generat cu interval valid (afișat, tipărit sau exportat) intră în Jurnal cu autorul.
Textul de neacceptare și cel pentru Sesiuni deschise vin de aici, nu sunt dublate în SPA."""

import sqlite3
from datetime import datetime
from typing import NamedTuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel

from gym_control import auth, journal, reports, runtime_settings
from gym_control.admin_common import UNAUTHORIZED, ErrorResponse
from gym_control.auth import Admin, require_admin_api
from gym_control.clocktime import local_iso, to_local
from gym_control.db import get_db
from gym_control.reports import InvalidInterval

router = APIRouter(
    prefix="/api/admin", tags=["reports"], dependencies=[Depends(auth.require_same_origin)],
)

_VERBS = {"report.generate": "generat", "report.export": "exportat"}
_RESPONSES = {400: {"model": ErrorResponse}, **UNAUTHORIZED}


class ReportRowOut(BaseModel):
    employee_name: str
    entry: str
    exit: str | None
    open: bool
    manual: bool
    label: str
    method_label: str


class ReportOut(BaseModel):
    date_from: str
    date_to: str
    generated_at: str
    generated_by: str
    disclaimer: str
    scope_text: str
    open_text: str
    rows: list[ReportRowOut]


class GeneratedReport(NamedTuple):
    rows: list[reports.ReportRow]
    start: datetime  # începutul intervalului, UTC
    end: datetime  # sfârșitul intervalului, UTC


def _generate_and_journal(
    request: Request, admin: Admin, db: sqlite3.Connection, raw_from: str, raw_to: str, action: str,
) -> GeneratedReport:
    """Interval valid: interoghează Sesiunile, scrie generarea în Jurnal (cu commit) și întoarce
    rândurile cu intervalul; altfel 400 cu mesajul în română."""
    settings = request.app.state.settings
    try:
        start, end = reports.parse_interval(raw_from, raw_to, settings.timezone)
    except InvalidInterval as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    closing = runtime_settings.current(db, settings).closing_time
    rows = reports.query(db, settings.timezone, closing, start, end)
    text = f"{local_iso(start, settings.timezone)} – {local_iso(end, settings.timezone)}"
    journal.write_admin_action(
        db, request.app.state.clock(), admin, action,
        f"Raport de prezență {_VERBS[action]}: {text} ({len(rows)} Sesiuni)",
        detail={"from": start.isoformat(), "to": end.isoformat(), "rows": len(rows)},
    )
    db.commit()
    return GeneratedReport(rows, start, end)


@router.get("/reports", response_model=ReportOut, responses=_RESPONSES)
def generate_report(
    request: Request,
    date_from: str = Query("", alias="from"),
    date_to: str = Query("", alias="to"),
    admin: Admin = Depends(require_admin_api),
    db: sqlite3.Connection = Depends(get_db),
):
    tz = request.app.state.settings.timezone
    report = _generate_and_journal(request, admin, db, date_from, date_to, "report.generate")
    return ReportOut(
        date_from=local_iso(report.start, tz), date_to=local_iso(report.end, tz),
        generated_at=local_iso(request.app.state.clock(), tz), generated_by=admin.username,
        disclaimer=reports.DISCLAIMER, scope_text=reports.SCOPE_TEXT, open_text=reports.OPEN_TEXT,
        rows=[
            ReportRowOut(
                employee_name=r.employee_name, entry=local_iso(r.entry_at, tz),
                exit=local_iso(r.exit_at, tz) if r.exit_at else None, open=r.open,
                manual=r.manual, label=r.label, method_label=r.method_label,
            )
            for r in report.rows
        ],
    )


@router.get("/reports.csv", response_class=Response, responses={
    200: {"content": {"text/csv": {}}}, **_RESPONSES})
def export_report_csv(
    request: Request,
    date_from: str = Query("", alias="from"),
    date_to: str = Query("", alias="to"),
    admin: Admin = Depends(require_admin_api),
    db: sqlite3.Connection = Depends(get_db),
):
    report = _generate_and_journal(request, admin, db, date_from, date_to, "report.export")
    tz = request.app.state.settings.timezone
    name = f"raport-prezenta_{to_local(report.start, tz):%Y%m%d-%H%M}_{to_local(report.end, tz):%Y%m%d-%H%M}.csv"
    return Response(
        reports.csv_bytes(report.rows, tz), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'})
