"""API JSON al Adminului (`/api/admin/*`): login, identitate, logout.

Cookie-ul de sesiune, verificarea `Origin` și limitarea încercărilor sunt cele de dinainte (ADR 0002).
O cerere fără sesiune primește 401; SPA-ul duce atunci la login."""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from gym_control import auth, employees, enrollment, journal, network
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
