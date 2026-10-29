"""Forma comună a erorilor Angajatului: `{detail, reason}` pe API, HTML pe paginile vechi."""

from gym_control import network
from gym_control.enrollment import EnrollmentRequired
from tests.conftest import HALL_IP, OUTSIDE_IP


def _with_probe_routes(client):
    """Rute-sondă pe API-ul Angajatului, ca să exersăm handlerele comune înainte să existe endpointurile reale."""

    def needs_hall():
        raise network.NotInHallNetwork()

    def needs_phone():
        raise EnrollmentRequired()

    client.app.add_api_route("/api/employee/_probe/hall", needs_hall)
    client.app.add_api_route("/api/employee/_probe/phone", needs_phone)
    return client


def test_wrong_network_is_json_403_with_reason(harness):
    c = _with_probe_routes(harness.client(OUTSIDE_IP))
    r = c.get("/api/employee/_probe/hall")
    assert r.status_code == 403
    body = r.json()
    assert body["reason"] == "not_in_hall_network"
    assert "Wi-Fi" in body["detail"]


def test_phone_not_activated_is_json_401_with_reason(harness):
    c = _with_probe_routes(harness.client(HALL_IP))
    r = c.get("/api/employee/_probe/phone")
    assert r.status_code == 401
    body = r.json()
    assert body["reason"] == "phone_not_activated"
    assert body["detail"]


def test_legacy_pages_still_answer_in_html(harness):
    r = harness.client(OUTSIDE_IP).post("/enroll/abc")
    assert r.status_code == 403
    assert "text/html" in r.headers["content-type"]
