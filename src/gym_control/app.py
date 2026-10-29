import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from gym_control import admin_api, auth, db, door, employee_api, enrollment, journal_api, manual_sessions, network, report_api, scheduler, spa, totp
from gym_control import admin_settings_api
from gym_control.settings import Settings

Clock = Callable[[], datetime]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_app(settings: Settings | None = None, clock: Clock = utc_now) -> FastAPI:
    """Fabrica aplicației. Ceasul și configurația sunt injectate din exterior."""
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        stop = threading.Event()
        thread = None
        if settings.scheduler_enabled:
            thread = threading.Thread(
                target=scheduler.run_loop, args=(app, stop, settings.scheduler_interval),
                name="gym-scheduler", daemon=True)
            thread.start()
        yield
        stop.set()
        if thread:
            thread.join(timeout=5)

    app = FastAPI(title="Gym Control", lifespan=lifespan)
    app.state.settings = settings
    app.state.clock = clock
    app.state.db = db.connect(settings.database)
    app.state.db_lock = threading.Lock()  # nu RLock: dependența `get_db` poate elibera din alt thread
    app.state.login_throttle = auth.LoginThrottle()
    app.state.tick = lambda now: scheduler.tick(app, now)
    app.state.totp_secret = totp.load_secret(app.state.db, settings.totp_secret)
    auth.ensure_bootstrap_admin(
        app.state.db, clock(),
        settings.bootstrap_admin_username, settings.bootstrap_admin_password,
    )
    app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")
    app.include_router(admin_api.router)
    app.include_router(admin_settings_api.router)
    app.include_router(journal_api.router)
    app.include_router(report_api.router)
    app.include_router(manual_sessions.router)
    app.include_router(enrollment.router)
    app.include_router(door.router)
    app.include_router(employee_api.router)
    app.add_exception_handler(enrollment.EnrollmentRequired, enrollment.enrollment_required_handler)

    app.add_exception_handler(network.NotInHallNetwork, network.not_in_hall_handler)

    # Catch-all-ul SPA se înregistrează ultimul: rutele HTML ale Angajatului și kioskului au prioritate.
    spa.mount(app, settings.frontend_dist)

    return app


def app_from_env() -> FastAPI:
    return create_app()
