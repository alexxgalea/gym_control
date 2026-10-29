"""API JSON al Adminului (`/api/admin/*`): login, identitate, logout.

Cookie-ul de sesiune, verificarea `Origin` și limitarea încercărilor sunt cele de dinainte (ADR 0002).
O cerere fără sesiune primește 401; SPA-ul duce atunci la login."""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from gym_control import auth, journal, network
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
