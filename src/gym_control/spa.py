"""Servește build-ul frontend-ului: punctul de intrare Admin la `/admin/*` (cu fallback la `index.html`, rutare în
browser) și punctul de intrare Angajat (`employee.html`) la adresele publice listate în `EMPLOYEE_PAGES`.
Fișierele statice ale ambelor (`assets/`) se servesc de sub `/admin/`, din același build."""

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse


# Adresele publice servite de punctul de intrare Angajat. `/door` are ruta lui în `door.py`, care servește
# tot punctul de intrare Angajat prin `employee_entry`.
EMPLOYEE_PAGES = ("/status", "/me", "/enroll/{token}", "/door/activate/{token}")


def employee_entry(request: Request) -> FileResponse:
    """Punctul de intrare Angajat (`employee.html`), 404 dacă build-ul lipsește."""
    dist = request.app.state.settings.frontend_dist
    page = Path(dist).resolve() / "employee.html" if dist else None
    if page is None or not page.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(page)


def mount(app: FastAPI, dist: str) -> None:
    root = Path(dist).resolve() if dist else None
    if root is None or not (root / "index.html").is_file():
        return

    employee_page = root / "employee.html"
    if employee_page.is_file():
        def employee_entry():
            return FileResponse(employee_page)

        for route in EMPLOYEE_PAGES:
            app.get(route, include_in_schema=False)(employee_entry)

    @app.get("/admin", include_in_schema=False)
    @app.get("/admin/{path:path}", include_in_schema=False)
    def spa(path: str = ""):
        candidate = (root / path).resolve()
        if path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        if path.startswith("assets/") or Path(path).suffix:
            raise HTTPException(status_code=404)  # un fișier lipsă nu primește index.html
        return FileResponse(root / "index.html")
