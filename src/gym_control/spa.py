"""Servește build-ul SPA-ului Admin la `/admin/*`, cu fallback la `index.html` (rutare în browser)."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse


def mount(app: FastAPI, dist: str) -> None:
    root = Path(dist).resolve() if dist else None
    if root is None or not (root / "index.html").is_file():
        return

    @app.get("/admin", include_in_schema=False)
    @app.get("/admin/{path:path}", include_in_schema=False)
    def spa(path: str = ""):
        candidate = (root / path).resolve()
        if path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        if path.startswith("assets/") or Path(path).suffix:
            raise HTTPException(status_code=404)  # un fișier lipsă nu primește index.html
        return FileResponse(root / "index.html")
