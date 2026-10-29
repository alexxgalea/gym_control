"""Validare de rețea (#7). Setările editabile: tests/test_admin_settings.py."""

from tests.conftest import HALL_IP, OUTSIDE_IP


def test_entry_and_exit_from_outside_subnet_are_rejected_with_message(harness):
    phone = harness.enrolled_client("Ana Pop")
    outside = harness.client(OUTSIDE_IP)
    outside.cookies.update(phone.cookies)
    r = outside.post("/api/employee/entry", json={"totp": harness.current_totp()})
    assert r.status_code == 403
    assert "rețeaua Sălii" in r.text
    phone.post("/api/employee/entry", json={"totp": harness.current_totp()})
    assert outside.post("/api/employee/exit", json={"totp": harness.current_totp()}).status_code == 403
    assert phone.get("/api/employee/me").json()["inside_since"] is not None  # Ieșirea nu a fost înregistrată


def test_entry_from_inside_subnet_is_accepted(harness):
    assert harness.enrolled_client("Ana Pop").post("/api/employee/entry", json={"totp": harness.current_totp()}).status_code == 200


def test_enrollment_post_outside_subnet_is_rejected_and_link_stays_usable(harness):
    link = harness.issue_enroll_link(harness.create_employee("Ana Pop"))
    outside = harness.client(OUTSIDE_IP)
    r = outside.post("/api/employee" + link)
    assert r.status_code == 403
    assert r.json()["reason"] == "not_in_hall_network"
    assert "gc_device" not in outside.cookies
    assert harness.enroll(link).post("/api/employee/entry", json={"totp": harness.current_totp()}).status_code == 200


def test_forwarded_for_is_ignored_by_default(harness):
    enrolled = harness.enrolled_client("Ana Pop")
    phone = harness.client(OUTSIDE_IP)
    phone.cookies.update(enrolled.cookies)
    r = phone.post("/api/employee/entry", json={"totp": harness.current_totp()},
                   headers={"X-Forwarded-For": HALL_IP})
    assert r.status_code == 403


def test_forwarded_for_is_honoured_only_from_trusted_proxy(make_harness):
    h = make_harness(trusted_proxies=(OUTSIDE_IP,))
    phone = h.enrolled_client("Ana Pop")
    proxy = h.client(OUTSIDE_IP)
    proxy.cookies.update(phone.cookies)
    totp = {"totp": h.current_totp()}
    # proxy de încredere: se folosește adresa din X-Forwarded-For (clientul real)
    assert proxy.post("/api/employee/entry", json=totp, headers={"X-Forwarded-For": HALL_IP}).status_code == 200
    assert proxy.post("/api/employee/exit", json=totp, headers={"X-Forwarded-For": "10.9.9.9"}).status_code == 403
    # un client oarecare nu poate falsifica antetul
    stranger = h.client("10.7.7.7")
    stranger.cookies.update(phone.cookies)
    assert stranger.post("/api/employee/exit", json=totp, headers={"X-Forwarded-For": HALL_IP}).status_code == 403
    # un X-Forwarded-For falsificat de client, adăugat în față de proxy, nu contează (se ia ultima adresă necunoscută)
    assert proxy.post("/api/employee/exit", json=totp,
                      headers={"X-Forwarded-For": f"{HALL_IP}, 10.9.9.9"}).status_code == 403
