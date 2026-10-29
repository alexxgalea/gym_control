"""Servește build-ul frontend-ului: punctul de intrare Admin la `/admin/*` (cu fallback la `index.html`, rutare în
browser) și punctul de intrare Angajat (`employee.html`) la adresele publice listate în `EMPLOYEE_PAGES`.
Fișierele statice ale ambelor (`assets/`) se servesc de sub `/admin/`, din același build."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse


# Adresele publice servite de punctul de intrare Angajat. `/enroll/{token}` și `/door` rămân pe paginile
# vechi până la tichetele lor; fiecare tichet își adaugă adresa aici.
EMPLOYEE_PAGES = ("/status", "/me")


def mount(app: FastAPI, dist: str) -> None:
    root = Path(dist).resolve() if dist else None
    if root is None or not (root / "index.html").is_file():
        return

    employee_page = root / "employee.html"
    if employee_page.is_file():
        for route in EMPLOYEE_PAGES:
            app.get(route, include_in_schema=False)(lambda: FileResponse(employee_page))

    @app.get("/admin", include_in_schema=False)
    @app.get("/admin/{path:path}", include_in_schema=False)
    def spa(path: str = ""):
        candidate = (root / path).resolve()
        if path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        if path.startswith("assets/") or Path(path).suffix:
            raise HTTPException(status_code=404)  # un fișier lipsă nu primește index.html
        return FileResponse(root / "index.html")
