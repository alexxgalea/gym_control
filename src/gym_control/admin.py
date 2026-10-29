"""Ecranele Admin: autentificare, Angajați, Jurnal."""

import sqlite3

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from gym_control import auth, journal
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
    rows = db.execute("SELECT id, name, email FROM employees ORDER BY name, id").fetchall()
    return templates.TemplateResponse(
        request, "employees.html", {"admin": admin, "employees": rows, "nav": "employees"}
    )
