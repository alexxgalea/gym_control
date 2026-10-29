"""Ecranele Admin ale Raportului de prezență: /admin/reports, /admin/reports/print, /admin/reports.csv.

Orice Raport generat cu interval valid (vizualizare, tipărit, CSV) intră în Jurnal cu autorul.
Logica (interval, interogare, CSV) e în `reports.py`."""

import sqlite3
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, Response

from gym_control import journal, reports, runtime_settings
from gym_control.auth import Admin, require_admin
from gym_control.clocktime import local_iso, to_local
from gym_control.db import get_db
from gym_control.reports import InvalidInterval
from gym_control.templates import templates

router = APIRouter(prefix="/admin")

_VERBS = {"report.generate": "generat", "report.export": "exportat"}


def _generate(request, admin, db, raw_from, raw_to, action):
    """Interval valid: întoarce (rânduri, x, y) și scrie în Jurnal; altfel ridică InvalidInterval."""
    settings = request.app.state.settings
    x, y = reports.parse_interval(raw_from, raw_to, settings.timezone)
    closing = runtime_settings.current(db, settings).closing_time
    rows = reports.query(db, settings.timezone, closing, x, y)
    text = f"{local_iso(x, settings.timezone)} – {local_iso(y, settings.timezone)}"
    journal.write_admin_action(
        db, request.app.state.clock(), admin, action,
        f"Raport de prezență {_VERBS[action]}: {text} ({len(rows)} Sesiuni)",
        detail={"from": x.isoformat(), "to": y.isoformat(), "rows": len(rows)},
    )
    db.commit()
    return rows, x, y


def _context(request, admin, raw_from, raw_to, **extra):
    return {
        "admin": admin, "nav": "reports", "tz": request.app.state.settings.timezone,
        "date_from": raw_from, "date_to": raw_to,
        "query": urlencode({"from": raw_from, "to": raw_to}), "rows": None, "error": None,
        "disclaimer": reports.DISCLAIMER, "open_text": reports.OPEN_TEXT, **extra,
    }


def _error(request, admin, raw_from, raw_to, exc):
    return templates.TemplateResponse(
        request, "report.html", _context(request, admin, raw_from, raw_to, error=str(exc)),
        status_code=400)


@router.get("/reports", response_class=HTMLResponse)
def report_page(
    request: Request,
    date_from: str = Query("", alias="from"),
    date_to: str = Query("", alias="to"),
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    if not date_from.strip() and not date_to.strip():
        return templates.TemplateResponse(request, "report.html", _context(request, admin, "", ""))
    try:
        rows, _, _ = _generate(request, admin, db, date_from, date_to, "report.generate")
    except InvalidInterval as exc:
        return _error(request, admin, date_from, date_to, exc)
    return templates.TemplateResponse(
        request, "report.html", _context(request, admin, date_from, date_to, rows=rows))


@router.get("/reports/print", response_class=HTMLResponse)
def report_print(
    request: Request,
    date_from: str = Query("", alias="from"),
    date_to: str = Query("", alias="to"),
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    try:
        rows, x, y = _generate(request, admin, db, date_from, date_to, "report.generate")
    except InvalidInterval as exc:
        return _error(request, admin, date_from, date_to, exc)
    return templates.TemplateResponse(
        request, "report_print.html",
        _context(request, admin, date_from, date_to, rows=rows, x=x, y=y,
                 generated_at=request.app.state.clock()))


@router.get("/reports.csv")
def report_csv(
    request: Request,
    date_from: str = Query("", alias="from"),
    date_to: str = Query("", alias="to"),
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    try:
        rows, x, y = _generate(request, admin, db, date_from, date_to, "report.export")
    except InvalidInterval as exc:
        return Response(str(exc), status_code=400, media_type="text/plain; charset=utf-8")
    tz = request.app.state.settings.timezone
    name = f"raport-prezenta_{to_local(x, tz):%Y%m%d-%H%M}_{to_local(y, tz):%Y%m%d-%H%M}.csv"
    return Response(
        reports.csv_bytes(rows, tz), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'})
