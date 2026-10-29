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
            "/admin/login",
            data={"username": ADMIN_USER, "password": ADMIN_PASSWORD},
            follow_redirects=False,
        )
        assert r.status_code == 303, r.text
        return c

    def kiosk_client(self, ip: str = HALL_IP) -> TestClient:
        """Telefonul de la ușă: tokenul de kiosk setat o singură dată (`/door?k=...`)."""
        c = self.client(ip)
        r = c.get(f"/door?k={KIOSK_TOKEN}", follow_redirects=True)
        assert r.status_code == 200, r.text
        return c

    def door_url(self) -> str:
        """Calea `/me?t=<TOTP>` codificată acum în QR-ul de la ușă (citită din pagina /door)."""
        m = re.search(r'data-qr-url="([^"]+)"', self.kiosk_client().get("/door").text)
        assert m, "pagina /door nu expune URL-ul din QR"
        return m.group(1).replace("&amp;", "&")

    def current_totp(self) -> str:
        """TOTP-ul din QR-ul afișat acum la ușă (după ceasul injectat)."""
        return re.search(r"[?&]t=([^&]+)", self.door_url()).group(1)

    def create_employee(self, name: str, email: str | None = None) -> int:
        """Creează un Angajat ca Admin și întoarce id-ul lui (citit din ecranul Angajați)."""
        email = email or f"{name.lower().replace(' ', '.')}@firma.ro"
        admin = self.admin_client()
        r = admin.post("/admin/employees", data={"name": name, "email": email},
                       follow_redirects=False)
        assert r.status_code == 303, r.text
        page = admin.get("/admin/employees").text
        m = re.search(rf'data-employee-id="(\d+)"[^>]*data-email="{re.escape(email.lower())}"', page)
        assert m, page
        return int(m.group(1))

    def issue_enroll_link(self, employee_id: int, admin: TestClient | None = None) -> str:
        """Admin generează linkul de înrolare; întoarce calea (`/enroll/<token>`)."""
        admin = admin or self.admin_client()
        r = admin.post(f"/admin/employees/{employee_id}/enroll-link")
        assert r.status_code == 200, r.text
        m = re.search(r"/enroll/[\w-]+", r.text)
        assert m, r.text
        return m.group(0)

    def enroll(self, link: str, ip: str = HALL_IP) -> TestClient:
        """Deschide linkul pe un client nou (telefonul Angajatului) și confirmă înrolarea."""
        c = self.client(ip)
        assert c.get(link).status_code == 200
        r = c.post(link, follow_redirects=False)
        assert r.status_code == 303, r.text
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
