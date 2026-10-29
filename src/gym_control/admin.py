"""Ecranele Admin: autentificare, Angajați, Jurnal."""

import sqlite3

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse

from gym_control import anomalies, auth, employees, enrollment, journal, runtime_settings
from gym_control.auth import Admin, require_admin
from gym_control.db import get_db
from gym_control.templates import templates

router = APIRouter(prefix="/admin")


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
    admin = auth.authenticate(db, username, password)
    if admin is None:
        return templates.TemplateResponse(
            request, "login.html", {"error": "Cont sau parolă greșite."}, status_code=401
        )
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


def _settings_response(request, admin, db, form, status_code=200, **extra):
    return templates.TemplateResponse(
        request, "settings.html", {"admin": admin, "nav": "settings", "form": form, **extra},
        status_code=status_code,
    )


def _form_values(s: runtime_settings.RuntimeSettings) -> dict[str, str]:
    return {"hall_subnet": s.hall_subnet, "opening_time": s.opening_time.strftime("%H:%M"),
            "closing_time": s.closing_time.strftime("%H:%M")}


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
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    form = {"hall_subnet": hall_subnet, "opening_time": opening_time, "closing_time": closing_time}
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
    admin: Admin = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    return templates.TemplateResponse(
        request, "journal.html", {"admin": admin, "entries": journal.recent(db), "nav": "journal",
         "tz": request.app.state.settings.timezone}
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
