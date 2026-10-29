import ipaddress
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from gym_control.settings import Settings

Clock = Callable[[], datetime]

_templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_app(settings: Settings | None = None, clock: Clock = utc_now) -> FastAPI:
    """Fabrica aplicației. Ceasul și configurația sunt injectate din exterior."""
    settings = settings or Settings.from_env()
    app = FastAPI(title="Gym Control")
    app.state.settings = settings
    app.state.clock = clock
    app.state.db = sqlite3.connect(settings.database, check_same_thread=False)

    @app.get("/status", response_class=HTMLResponse)
    def status(request: Request):
        source_ip = request.client.host if request.client else ""
        in_hall = _in_subnet(source_ip, settings.hall_subnet)
        return _templates.TemplateResponse(
            request,
            "status.html",
            {"now": clock().isoformat(), "in_hall": in_hall},
        )

    return app


def _in_subnet(ip: str, subnet: str) -> bool:
    try:
        return ipaddress.ip_address(ip) in ipaddress.ip_network(subnet)
    except ValueError:
        return False


def app_from_env() -> FastAPI:
    return create_app()
