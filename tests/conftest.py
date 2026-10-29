"""Seamul unic de test: aplicația apelată prin HTTP.

Controlat din exterior: ceasul, IP-ul sursă al cererii și configurația.
Baza de date este SQLite în memorie. Testele nu importă module interne,
doar `create_app` și `Settings` prin acest fișier.
"""

import re
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
KIOSK_TOKEN = "token-kiosk-de-test"


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
    _tick: callable = None

    def client(self, ip: str = HALL_IP) -> TestClient:
        """Client HTTP cu IP-ul sursă dat (implicit: în subrețeaua Sălii)."""
        return self._client_factory(ip)

    def tick(self) -> None:
        """Rulează `tick` la ceasul controlat (aceeași cale ca schedulerul de producție)."""
        self._tick(self.clock())

    def admin_client(self, ip: str = HALL_IP) -> TestClient:
        """Client deja autentificat ca Admin-ul de bootstrap (ADMIN_USER)."""
        c = self.client(ip)
        r = c.post(
            "/api/admin/login",
            json={"username": ADMIN_USER, "password": ADMIN_PASSWORD},
        )
        assert r.status_code == 200, r.text
        return c

    def kiosk_client(self, ip: str = HALL_IP) -> TestClient:
        """Telefonul de la ușă: tokenul de kiosk setat o singură dată (`/door?k=...`)."""
        c = self.client(ip)
        r = c.get(f"/door?k={KIOSK_TOKEN}", follow_redirects=False)
        assert r.status_code == 303, r.text
        return c

    def door_url(self) -> str:
        """Adresa `/me?t=<TOTP>` codificată acum în QR-ul de la ușă (din endpointul JSON al Ecranului de la ușă)."""
        r = self.kiosk_client().get("/api/employee/door/qr")
        assert r.status_code == 200, r.text
        return r.json()["url"]

    def current_totp(self) -> str:
        """TOTP-ul din QR-ul afișat acum la ușă (după ceasul injectat)."""
        return re.search(r"[?&]t=([^&]+)", self.door_url()).group(1)

    def create_employee(self, name: str, email: str | None = None) -> int:
        """Creează un Angajat ca Admin și întoarce id-ul lui (citit din ecranul Angajați)."""
        email = email or f"{name.lower().replace(' ', '.')}@firma.ro"
        r = self.admin_client().post("/api/admin/employees", json={"name": name, "email": email})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def issue_enroll_link(self, employee_id: int, admin: TestClient | None = None) -> str:
        """Admin generează linkul de înrolare; întoarce calea (`/enroll/<token>`)."""
        admin = admin or self.admin_client()
        r = admin.post(f"/api/admin/employees/{employee_id}/enroll-link")
        assert r.status_code == 200, r.text
        return "/enroll/" + r.json()["link"].rsplit("/enroll/", 1)[1]

    def enroll(self, link: str, ip: str = HALL_IP) -> TestClient:
        """Deschide linkul pe un client nou (telefonul Angajatului) și activează telefonul (API JSON)."""
        c = self.client(ip)
        api = "/api/employee" + link
        assert c.get(api).status_code == 200
        r = c.post(api)
        assert r.status_code == 200, r.text
        return c

    def enrolled_client(self, name: str = "Ana Pop", email: str | None = None,
                        ip: str = HALL_IP) -> TestClient:
        """Client (telefon) deja înrolat ca Angajatul `name`, cu cookie-ul de dispozitiv."""
        employee_id = self.create_employee(name, email)
        return self.enroll(self.issue_enroll_link(employee_id), ip)


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
            kiosk_token=KIOSK_TOKEN,
            totp_secret="secret-totp-de-test",
        )
        settings = Settings(**{**defaults, **overrides})
        app = create_app(settings=settings, clock=clock)

        def factory(ip: str) -> TestClient:
            # Ca un browser: POST-urile poartă Origin-ul aplicației (protecția CSRF a ecranelor Admin).
            c = TestClient(app, client=(ip, 50000), headers={"Origin": "http://testserver"})
            clients.append(c)
            return c

        return Harness(clock=clock, settings=settings, _client_factory=factory,
                       _tick=app.state.tick)

    yield _make
    for c in clients:
        c.close()


@pytest.fixture
def harness(make_harness) -> Harness:
    return make_harness()
