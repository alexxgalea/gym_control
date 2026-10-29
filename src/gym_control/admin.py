"""Ecranele Admin: autentificare, Angajați, Jurnal."""

import sqlite3
from datetime import date
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse

from gym_control import anomalies, auth, network, employees, enrollment, incidents, journal, runtime_settings
from gym_control.auth import Admin, require_admin
from gym_control.db import get_db
from gym_control.templates import templates

router = APIRouter(prefix="/admin", dependencies=[Depends(auth.require_same_origin)])
KEEP = "\x00keep"  # valoare implicită a câmpurilor de formular lipsă (golul "" e valoare reală)


@router.get("/login", response_class=HTMLResponse)
def login_form(request: Request):
    return templates.TemplateResponse(request, "login.html", {"error": None})


@router.post("/login")
def login(
    request: Request,
    username: str = Form(""),
    password: str = Form(""),
    db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    throttle: auth.LoginThrottle = request.app.state.login_throttle
    key = (network.source_ip(request), username.strip().lower())
    wait = throttle.retry_after(key, now)
    if wait is not None:
        minutes = int(wait.total_seconds() // 60) + 1
        return templates.TemplateResponse(
            request, "login.html",
            {"error": f"Prea multe încercări eșuate. Încearcă din nou peste {minutes} min."},
            status_code=429,
        )
    admin = auth.authenticate(db, username, password)
    if admin is None:
        throttle.record_failure(key, now)
        return templates.TemplateResponse(
            request, "login.html", {"error": "Cont sau parolă greșite."}, status_code=401
        )
    throttle.record_success(key)
    token = auth.open_session(db, now, admin)
    journal.write_admin_action(db, now, admin, "admin.login", "Autentificare")
    db.commit()
    response = RedirectResponse("/admin/employees", status_code=303)
    response.set_cookie(
        auth.COOKIE, token, httponly=True, samesite="lax",
        max_age=int(auth.SESSION_TTL.total_seconds()),
    )
    return response


@router.post("/logout")
def logout(request: Request, db: sqlite3.Connection = Depends(get_db)):
    token = request.cookies.get(auth.COOKIE)
    if token:
        auth.close_session(db, token)
    response = RedirectResponse("/admin/login", status_code=303)
    response.delete_cookie(auth.COOKIE)
    return response


@router.get("/employees", response_class=HTMLResponse)
def employees_page(
    request: Request,
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    return _employees_response(request, admin, db)


def _employees_response(request, admin, db, status_code=200, **extra):
    context = {
        "admin": admin, "employees": employees.list_all(db), "nav": "employees",
        "enrolled_ids": enrollment.enrolled_ids(db), **extra,
    }
    return templates.TemplateResponse(request, "employees.html", context, status_code=status_code)


@router.post("/employees")
def create_employee(
    request: Request,
    name: str = Form(""),
    email: str = Form(""),
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    try:
        employee_id = employees.add(db, now, name, email)
    except employees.InvalidEmployee as exc:
        db.rollback()
        return _employees_response(
            request, admin, db, status_code=400,
            form_error=str(exc).capitalize(), form={"name": name, "email": email},
        )
    journal.write_admin_action(
        db, now, admin, "employee.create", f"Angajat creat: {' '.join(name.split())}",
        employee_id=employee_id,
    )
    db.commit()
    return RedirectResponse("/admin/employees", status_code=303)


def _employee_or_404(db, employee_id: int):
    row = db.execute("SELECT id, name FROM employees WHERE id = ?", (employee_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Angajat inexistent")
    return row


@router.post("/employees/{employee_id}/enroll-link", response_class=HTMLResponse)
def create_enroll_link(
    request: Request,
    employee_id: int,
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    employee = _employee_or_404(db, employee_id)
    token = enrollment.issue_link(db, now, employee_id)
    journal.write_admin_action(
        db, now, admin, "enroll.link",
        f"Link de înrolare generat pentru {employee['name']}", employee_id=employee_id,
    )
    db.commit()
    link = str(request.base_url).rstrip("/") + f"/enroll/{token}"
    return _employees_response(
        request, admin, db,
        issued={"name": employee["name"], "link": link,
                "hours": int(enrollment.LINK_TTL.total_seconds() // 3600)},
    )


@router.post("/employees/{employee_id}/revoke")
def revoke_device(
    request: Request,
    employee_id: int,
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    employee = _employee_or_404(db, employee_id)
    enrollment.revoke(db, employee_id)
    journal.write_admin_action(
        db, now, admin, "enroll.revoke",
        f"Dispozitiv revocat pentru {employee['name']}", employee_id=employee_id,
    )
    db.commit()
    return RedirectResponse("/admin/employees", status_code=303)


@router.post("/employees/import")
async def import_employees(
    request: Request,
    file: UploadFile,
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    raw = await file.read()
    result = employees.ImportResult()
    try:
        rows = list(employees.parse_csv(raw))
    except ValueError as exc:
        return _employees_response(request, admin, db, status_code=400, import_fatal=str(exc))
    for line, cells in rows:
        if len(cells) != 2:
            result.errors.append(f"Rândul {line}: se așteaptă două coloane (nume, email).")
            continue
        try:
            employee_id = employees.add(db, now, cells[0], cells[1])
        except employees.InvalidEmployee as exc:
            result.errors.append(f"Rândul {line}: {exc}.")
            continue
        result.created += 1
        journal.write_admin_action(
            db, now, admin, "employee.import",
            f"Angajat importat din CSV: {' '.join(cells[0].split())}",
            employee_id=employee_id,
        )
    journal.write_admin_action(
        db, now, admin, "employees.import_csv",
        f"Import CSV: {result.created} importați, {len(result.errors)} respinse",
        detail={"created": result.created, "errors": result.errors},
    )
    db.commit()
    return _employees_response(request, admin, db, result=result)


def _parse_day(value: str) -> date | None:
    value = value.strip()
    return date.fromisoformat(value) if value else None



def _settings_response(request, admin, db, form, status_code=200, **extra):
    return templates.TemplateResponse(
        request, "settings.html", {"admin": admin, "nav": "settings", "form": form, **extra},
        status_code=status_code,
    )


def _form_values(s: runtime_settings.RuntimeSettings) -> dict[str, str]:
    return {"hall_subnet": s.hall_subnet, "opening_time": s.opening_time.strftime("%H:%M"),
            "closing_time": s.closing_time.strftime("%H:%M"),
            "retention_months": str(s.retention_months)}


@router.get("/settings", response_class=HTMLResponse)
def settings_page(
    request: Request,
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    current = runtime_settings.current(db, request.app.state.settings)
    return _settings_response(request, admin, db, _form_values(current))


@router.post("/settings")
def save_settings(
    request: Request,
    hall_subnet: str = Form(""),
    opening_time: str = Form(""),
    closing_time: str = Form(""),
    retention_months: str = Form(KEEP),
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    if retention_months == KEEP:  # câmp lipsă din formular: rămâne valoarea curentă
        retention_months = str(runtime_settings.current(db, request.app.state.settings).retention_months)
    form = {"hall_subnet": hall_subnet, "opening_time": opening_time, "closing_time": closing_time,
            "retention_months": retention_months}
    new, errors = runtime_settings.validate(form)
    if errors:
        return _settings_response(request, admin, db, form, status_code=400, errors=errors)
    old = runtime_settings.current(db, request.app.state.settings)
    runtime_settings.save(db, request.app.state.clock(), admin, old, new)
    db.commit()
    return RedirectResponse("/admin/settings", status_code=303)


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
