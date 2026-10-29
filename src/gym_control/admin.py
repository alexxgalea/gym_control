"""Rute Admin rămase în afara SPA-ului: redirecționarea rutei vechi a Jurnalului."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from gym_control import auth

router = APIRouter(prefix="/admin", dependencies=[Depends(auth.require_same_origin)])


@router.get("/jurnal", include_in_schema=False)
def journal_moved(request: Request):
    """Ruta veche a Jurnalului: SPA-ul îl servește la `/admin/journal`, cu aceleași filtre în query."""
    query = request.url.query
    return RedirectResponse("/admin/journal" + (f"?{query}" if query else ""), status_code=307)
