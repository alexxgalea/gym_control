"""Piese comune ale routerelor API JSON ale Adminului: formele de eroare și răspunsul 400 cu `field`."""

import sqlite3

from fastapi.responses import JSONResponse
from pydantic import BaseModel


class ErrorResponse(BaseModel):
    detail: str


class FieldErrorResponse(BaseModel):
    """Eroare de validare în română; `field` indică câmpul din formular."""

    detail: str
    field: str | None = None


UNAUTHORIZED = {401: {"model": ErrorResponse}}


def field_error(db: sqlite3.Connection, detail: str, field: str | None, **extra) -> JSONResponse:
    """Anulează scrierile neterminate ale cererii și întoarce 400 `{detail, field}`."""
    db.rollback()
    return JSONResponse(status_code=400, content={"detail": detail, "field": field, **extra})
