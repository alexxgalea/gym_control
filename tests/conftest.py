"""Seamul unic de test: aplicația apelată prin HTTP.

Controlat din exterior: ceasul, IP-ul sursă al cererii și configurația.
Baza de date este SQLite în memorie. Testele nu importă module interne,
doar `create_app` și `Settings` prin acest fișier.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from gym_control.app import create_app
from gym_control.settings import Settings

HALL_IP = "192.168.10.25"
OUTSIDE_IP = "10.0.0.5"
ADMIN_USER = "admin"
ADMIN_PASSWORD = "parola-de-test-1"


class FakeClock:
    """Ceas controlat de test; `advance` înlocuiește orice `sleep`."""

    def __init__(self, start: datetime):
        self._now = start

    def __call__(self) -> datetime:
        return self._now

    def advance(self, **delta) -> None:
        self._now += timedelta(**delta)

    def set(self, now: datetime) -> None:
        self._now = now


@dataclass
class Harness:
    clock: FakeClock
    settings: Settings
    _client_factory: callable

    def client(self, ip: str = HALL_IP) -> TestClient:
        """Client HTTP cu IP-ul sursă dat (implicit: în subrețeaua Sălii)."""
        return self._client_factory(ip)

    def admin_client(self, ip: str = HALL_IP) -> TestClient:
        """Client deja autentificat ca Admin-ul de bootstrap (ADMIN_USER)."""
        c = self.client(ip)
        r = c.post(
            "/admin/login",
            data={"username": ADMIN_USER, "password": ADMIN_PASSWORD},
            follow_redirects=False,
        )
        assert r.status_code == 303, r.text
        return c


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock(datetime(2026, 1, 5, 8, 12, tzinfo=timezone.utc))


@pytest.fixture
def make_harness(clock):
    """Fabrică: `make_harness(hall_subnet=...)` suprascrie configurația."""
    clients: list[TestClient] = []

    def _make(**overrides) -> Harness:
        defaults = dict(
            database=":memory:",
            bootstrap_admin_username=ADMIN_USER,
            bootstrap_admin_password=ADMIN_PASSWORD,
        )
        settings = Settings(**{**defaults, **overrides})
        app = create_app(settings=settings, clock=clock)

        def factory(ip: str) -> TestClient:
            c = TestClient(app, client=(ip, 50000))
            clients.append(c)
            return c

        return Harness(clock=clock, settings=settings, _client_factory=factory)

    yield _make
    for c in clients:
        c.close()


@pytest.fixture
def harness(make_harness) -> Harness:
    return make_harness()
