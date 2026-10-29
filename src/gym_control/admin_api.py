"""API JSON al Adminului (`/api/admin/*`): login, identitate, logout.

Cookie-ul de sesiune, verificarea `Origin` și limitarea încercărilor sunt cele de dinainte (ADR 0002).
O cerere fără sesiune primește 401; SPA-ul duce atunci la login."""

import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from gym_control import anomalies, auth, clocktime, employees, enrollment, incidents, journal, network
from gym_control.auth import Admin, require_admin_api
from gym_control.db import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(auth.require_same_origin)])


class LoginRequest(BaseModel):
    username: str = ""
    password: str = ""


class AdminAccount(BaseModel):
    username: str


class ErrorResponse(BaseModel):
    detail: str


@router.post(
    "/login", response_model=AdminAccount,
    responses={401: {"model": ErrorResponse}, 429: {"model": ErrorResponse}},
)
def login(
    body: LoginRequest, request: Request, response: Response,
    db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    throttle: auth.LoginThrottle = request.app.state.login_throttle
    key = (network.source_ip(request), body.username.strip().lower())
    wait = throttle.retry_after(key, now)
    if wait is not None:
        minutes = int(wait.total_seconds() // 60) + 1
        raise HTTPException(
            status_code=429,
            detail=f"Prea multe încercări eșuate. Încearcă din nou peste {minutes} min.",
        )
    admin = auth.authenticate(db, body.username, body.password)
    if admin is None:
        throttle.record_failure(key, now)
        raise HTTPException(status_code=401, detail="Cont sau parolă greșite.")
    throttle.record_success(key)
    token = auth.open_session(db, now, admin)
    journal.write_admin_action(db, now, admin, "admin.login", "Autentificare")
    db.commit()
    response.set_cookie(
        auth.COOKIE, token, httponly=True, samesite="lax",
        max_age=int(auth.SESSION_TTL.total_seconds()),
    )
    return AdminAccount(username=admin.username)


@router.get("/me", response_model=AdminAccount, responses={401: {"model": ErrorResponse}})
def me(admin: Admin = Depends(require_admin_api)):
    return AdminAccount(username=admin.username)


@router.post("/logout", status_code=204)
def logout(request: Request, db: sqlite3.Connection = Depends(get_db)):
    token = request.cookies.get(auth.COOKIE)
    if token:
        auth.close_session(db, token)
    response = Response(status_code=204)
    response.delete_cookie(auth.COOKIE)
    return response


class EmployeeOut(BaseModel):
    id: int
    name: str
    email: str
    enrolled: bool


class EmployeeIn(BaseModel):
    name: str = ""
    email: str = ""


class FieldErrorResponse(BaseModel):
    """Eroare de validare în română; `field` indică câmpul din formular (`name` sau `email`)."""

    detail: str
    field: str | None = None


class EnrollLink(BaseModel):
    name: str
    link: str
    hours: int


@router.get("/employees", response_model=list[EmployeeOut], responses={401: {"model": ErrorResponse}})
def list_employees(admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db)):
    enrolled = enrollment.enrolled_ids(db)
    return [
        EmployeeOut(id=e["id"], name=e["name"], email=e["email"], enrolled=e["id"] in enrolled)
        for e in employees.list_all(db)
    ]


@router.post(
    "/employees", status_code=201, response_model=EmployeeOut,
    responses={400: {"model": FieldErrorResponse}, 401: {"model": ErrorResponse}},
)
def create_employee(
    body: EmployeeIn, request: Request,
    admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    try:
        employee_id = employees.add(db, now, body.name, body.email)
    except employees.InvalidEmployee as exc:
        db.rollback()
        return JSONResponse(
            status_code=400, content={"detail": str(exc).capitalize(), "field": exc.field},
        )
    journal.write_admin_action(
        db, now, admin, "employee.create", f"Angajat creat: {' '.join(body.name.split())}",
        employee_id=employee_id,
    )
    db.commit()
    row = db.execute("SELECT id, name, email FROM employees WHERE id = ?", (employee_id,)).fetchone()
    return EmployeeOut(id=row["id"], name=row["name"], email=row["email"], enrolled=False)


class ImportReport(BaseModel):
    created: int
    errors: list[str]


@router.post(
    "/employees/import", response_model=ImportReport,
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}},
)
async def import_employees(
    file: UploadFile, request: Request,
    admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    try:
        rows = list(employees.parse_csv(await file.read()))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    result = employees.ImportResult()
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
            f"Angajat importat din CSV: {' '.join(cells[0].split())}", employee_id=employee_id,
        )
    journal.write_admin_action(
        db, now, admin, "employees.import_csv",
        f"Import CSV: {result.created} importați, {len(result.errors)} respinse",
        detail={"created": result.created, "errors": result.errors},
    )
    db.commit()
    return ImportReport(created=result.created, errors=result.errors)


def _employee_or_404(db: sqlite3.Connection, employee_id: int):
    row = db.execute("SELECT id, name FROM employees WHERE id = ?", (employee_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Angajat inexistent")
    return row


@router.post(
    "/employees/{employee_id}/enroll-link", response_model=EnrollLink,
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
def create_enroll_link(
    employee_id: int, request: Request,
    admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    employee = _employee_or_404(db, employee_id)
    token = enrollment.issue_link(db, now, employee_id)
    journal.write_admin_action(
        db, now, admin, "enroll.link",
        f"Link de înrolare generat pentru {employee['name']}", employee_id=employee_id,
    )
    db.commit()
    return EnrollLink(
        name=employee["name"],
        link=str(request.base_url).rstrip("/") + f"/enroll/{token}",
        hours=int(enrollment.LINK_TTL.total_seconds() // 3600),
    )


@router.post(
    "/employees/{employee_id}/revoke", status_code=204,
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
def revoke_device(
    employee_id: int, request: Request,
    admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    employee = _employee_or_404(db, employee_id)
    enrollment.revoke(db, employee_id)
    journal.write_admin_action(
        db, now, admin, "enroll.revoke",
        f"Dispozitiv revocat pentru {employee['name']}", employee_id=employee_id,
    )
    db.commit()
    return Response(status_code=204)


class AnomalyOut(BaseModel):
    """O Anomalie nerezolvată; `at` și `entry_at` sunt în ora locală (`AAAA-LL-ZZ HH:MM`).
    `exit_at` e `null` cât Sesiunea e deschisă (atunci Adminul o poate corecta)."""

    id: int
    session_id: int
    code: str
    label: str
    employee_name: str
    at: str
    entry_at: str
    exit_at: str | None


@router.get("/anomalies", response_model=list[AnomalyOut], responses={401: {"model": ErrorResponse}})
def list_anomalies(
    request: Request, admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    tz = request.app.state.settings.timezone
    return [
        AnomalyOut(
            id=a["id"], session_id=a["session_id"], code=a["code"],
            label=anomalies.LABELS.get(a["code"], a["code"]), employee_name=a["employee_name"],
            at=clocktime.local_iso(a["at"], tz), entry_at=clocktime.local_iso(a["entry_at"], tz),
            exit_at=clocktime.local_iso(a["exit_at"], tz) if a["exit_at"] else None,
        )
        for a in anomalies.list_unresolved(db)
    ]


@router.post(
    "/anomalies/{anomaly_id}/dismiss", status_code=204,
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
def dismiss_anomaly(
    anomaly_id: int, request: Request,
    admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
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
    return Response(status_code=204)
class IncidentOut(BaseModel):
    """Un Incident, cu orele în ora locală a Sălii (`AAAA-LL-ZZ HH:MM`); `status` e `open` sau `closed`."""

    id: int
    start: str
    end: str
    note: str
    status: Literal["open", "closed"]
    created_by: str
    closed_at: str | None = None
    closed_by: str | None = None


class IncidentIn(BaseModel):
    """Orele vin ca în `datetime-local` (`AAAA-LL-ZZTHH:MM`), în ora locală."""

    start: str = ""
    end: str = ""
    note: str = ""


def _incident_out(row, tz: str) -> IncidentOut:
    closed = row["closed_at"] is not None
    return IncidentOut(
        id=row["id"], start=clocktime.local_iso(row["start_at"], tz), end=clocktime.local_iso(row["end_at"], tz),
        note=row["note"], status="closed" if closed else "open", created_by=row["created_by"],
        closed_at=clocktime.local_iso(row["closed_at"], tz) if closed else None, closed_by=row["closed_by"],
    )


@router.get("/incidents", response_model=list[IncidentOut], responses={401: {"model": ErrorResponse}})
def list_incidents(
    request: Request, admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    tz = request.app.state.settings.timezone
    return [_incident_out(row, tz) for row in incidents.list_all(db)]


@router.post(
    "/incidents", status_code=201, response_model=IncidentOut,
    responses={400: {"model": FieldErrorResponse}, 401: {"model": ErrorResponse}},
)
def create_incident(
    body: IncidentIn, request: Request,
    admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    tz = request.app.state.settings.timezone
    try:
        incident_id = incidents.mark(db, request.app.state.clock(), tz, admin, body.start, body.end, body.note)
    except incidents.InvalidIncident as exc:
        db.rollback()
        return JSONResponse(status_code=400, content={"detail": str(exc), "field": exc.field})
    db.commit()
    return _incident_out(db.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone(), tz)


@router.post(
    "/incidents/{incident_id}/close", response_model=IncidentOut,
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
def close_incident(
    incident_id: int, request: Request,
    admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    tz = request.app.state.settings.timezone
    if not incidents.close(db, request.app.state.clock(), tz, admin, incident_id):
        raise HTTPException(status_code=404, detail="Incident inexistent sau deja închis")
    db.commit()
    return _incident_out(db.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone(), tz)
