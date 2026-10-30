"""API JSON al Adminului (`/api/admin/*`): login, identitate, logout.

Cookie-ul de sesiune, verificarea `Origin` și limitarea încercărilor sunt cele de dinainte (ADR 0002).
O cerere fără sesiune primește 401; SPA-ul duce atunci la login."""

import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel

from gym_control import anomalies, auth, clocktime, door, employees, enrollment, incidents, journal, network, presence
from gym_control.admin_common import UNAUTHORIZED, ErrorResponse, FieldErrorResponse, field_error
from gym_control.auth import Admin, require_admin_api
from gym_control.db import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(auth.require_same_origin)])


class LoginRequest(BaseModel):
    username: str = ""
    password: str = ""


class AdminAccount(BaseModel):
    username: str


@router.post(
    "/login", response_model=AdminAccount,
    responses={**UNAUTHORIZED, 429: {"model": ErrorResponse}},
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


@router.get("/me", response_model=AdminAccount, responses=UNAUTHORIZED)
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


class EnrollLink(BaseModel):
    name: str
    link: str
    qr_svg: str
    hours: int


@router.get("/employees", response_model=list[EmployeeOut], responses=UNAUTHORIZED)
def list_employees(admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db)):
    enrolled = enrollment.enrolled_ids(db)
    return [
        EmployeeOut(id=e["id"], name=e["name"], email=e["email"], enrolled=e["id"] in enrolled)
        for e in employees.list_all(db)
    ]


@router.post(
    "/employees", status_code=201, response_model=EmployeeOut,
    responses={400: {"model": FieldErrorResponse}, **UNAUTHORIZED},
)
def create_employee(
    body: EmployeeIn, request: Request,
    admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    try:
        employee_id = employees.add(db, now, body.name, body.email)
    except employees.InvalidEmployee as exc:
        return field_error(db, str(exc).capitalize(), exc.field)
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
    responses={400: {"model": ErrorResponse}, **UNAUTHORIZED},
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
    row = employees.get(db, employee_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Angajat inexistent")
    return row


@router.post(
    "/employees/{employee_id}/enroll-link", response_model=EnrollLink,
    responses={**UNAUTHORIZED, 404: {"model": ErrorResponse}},
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
        f"Activare telefon: link generat pentru {employee['name']}", employee_id=employee_id,
    )
    db.commit()
    link = str(request.base_url).rstrip("/") + f"/enroll/{token}"
    return EnrollLink(
        name=employee["name"],
        link=link,
        qr_svg=door.qr_svg(link),
        hours=int(enrollment.LINK_TTL.total_seconds() // 3600),
    )


@router.post(
    "/employees/{employee_id}/revoke", status_code=204,
    responses={**UNAUTHORIZED, 404: {"model": ErrorResponse}},
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
        f"Telefon scos din uz: {employee['name']}", employee_id=employee_id,
    )
    db.commit()
    return Response(status_code=204)


@router.delete(
    "/employees/{employee_id}", status_code=204,
    responses={**UNAUTHORIZED, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def delete_employee(
    employee_id: int, request: Request,
    admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    employee = _employee_or_404(db, employee_id)
    if presence.open_session(db, employee_id) is not None:
        raise HTTPException(
            status_code=409,
            detail=f"{employee['name']} este în Sală acum. Corectează întâi Sesiunea deschisă, apoi șterge Angajatul.",
        )
    enrollment.revoke(db, employee_id)
    employees.soft_delete(db, now, employee_id)
    journal.write_admin_action(
        db, now, admin, "employee.delete", f"Angajat șters: {employee['name']}", employee_id=employee_id,
    )
    db.commit()
    return Response(status_code=204)


class AnomalyOut(BaseModel):
    """O Anomalie nerezolvată; `at` și `entry_at` sunt în ora locală (`AAAA-LL-ZZ HH:MM`).
    `exit_at` e `null` cât Sesiunea e deschisă (atunci Adminul o poate corecta).
    `timezone` e fusul Sălii, ca interfața să poată scrie „azi”/„ieri” în ora Sălii."""

    id: int
    session_id: int
    code: str
    label: str
    employee_name: str
    at: str
    entry_at: str
    exit_at: str | None
    timezone: str


@router.get("/anomalies", response_model=list[AnomalyOut], responses=UNAUTHORIZED)
def list_anomalies(
    request: Request, admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    tz = request.app.state.settings.timezone
    return [
        AnomalyOut(
            id=a["id"], session_id=a["session_id"], code=a["code"],
            label=anomalies.LABELS.get(a["code"], a["code"]), employee_name=a["employee_name"],
            at=clocktime.local_iso(a["at"], tz), entry_at=clocktime.local_iso(a["entry_at"], tz),
            exit_at=clocktime.local_iso(a["exit_at"], tz) if a["exit_at"] else None, timezone=tz,
        )
        for a in anomalies.list_unresolved(db)
    ]


@router.post(
    "/anomalies/{anomaly_id}/dismiss", status_code=204,
    responses={**UNAUTHORIZED, 404: {"model": ErrorResponse}},
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
    timezone: str


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
        timezone=tz,
    )


@router.get("/incidents", response_model=list[IncidentOut], responses=UNAUTHORIZED)
def list_incidents(
    request: Request, admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    tz = request.app.state.settings.timezone
    return [_incident_out(row, tz) for row in incidents.list_all(db)]


@router.post(
    "/incidents", status_code=201, response_model=IncidentOut,
    responses={400: {"model": FieldErrorResponse}, **UNAUTHORIZED},
)
def create_incident(
    body: IncidentIn, request: Request,
    admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    tz = request.app.state.settings.timezone
    try:
        incident_id = incidents.mark(db, request.app.state.clock(), tz, admin, body.start, body.end, body.note)
    except incidents.InvalidIncident as exc:
        return field_error(db, str(exc), exc.field)
    db.commit()
    return _incident_out(db.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone(), tz)


@router.post(
    "/incidents/{incident_id}/close", response_model=IncidentOut,
    responses={**UNAUTHORIZED, 404: {"model": ErrorResponse}},
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


class DoorScreenStatus(BaseModel):
    """Starea Ecranului de la ușă; `activated_at` e în ora locală a Sălii (`AAAA-LL-ZZ HH:MM`)."""

    active: bool
    activated_at: str | None
    timezone: str


class DoorActivationLink(BaseModel):
    link: str
    qr_svg: str
    hours: int


@router.get("/door-screen", response_model=DoorScreenStatus, responses=UNAUTHORIZED)
def door_screen_status(
    request: Request, admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    tz = request.app.state.settings.timezone
    since = door.active_since(db)
    return DoorScreenStatus(
        active=since is not None, activated_at=clocktime.local_iso(since, tz) if since else None, timezone=tz)


@router.post("/door-screen/activation-link", response_model=DoorActivationLink, responses=UNAUTHORIZED)
def create_door_activation_link(
    request: Request, admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    now = request.app.state.clock()
    token = door.issue_link(db, now, admin)
    journal.write_admin_action(db, now, admin, "door.link", "Activare Ecran de la ușă: link generat")
    db.commit()
    link = str(request.base_url).rstrip("/") + f"/door/activate/{token}"
    return DoorActivationLink(link=link, qr_svg=door.qr_svg(link), hours=int(door.LINK_TTL.total_seconds() // 3600))


@router.delete("/door-screen", status_code=204, responses={**UNAUTHORIZED, 404: {"model": ErrorResponse}})
def retire_door_screen(
    request: Request, admin: Admin = Depends(require_admin_api), db: sqlite3.Connection = Depends(get_db),
):
    """Scoate din uz Ecranul de la ușă fără înlocuire (telefon pierdut sau furat)."""
    now = request.app.state.clock()
    if not door.retire(db):
        raise HTTPException(status_code=404, detail="Nu există un Ecran de la ușă activ")
    journal.write_admin_action(db, now, admin, "door.retire", "Ecranul de la ușă scos din uz")
    db.commit()
    return Response(status_code=204)
