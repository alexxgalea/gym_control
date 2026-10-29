"""Kiosk `/door` cu QR TOTP. Ceasul de test: 08:12:00 UTC."""

from tests.conftest import KIOSK_TOKEN


def _door_totp(h):
    return h.current_totp()


def _entry(make_harness, tmp_path, **overrides):
    (tmp_path / "index.html").write_text("<title>admin</title>")
    (tmp_path / "employee.html").write_text("<title>angajat</title>")
    return make_harness(frontend_dist=str(tmp_path), **overrides)


def test_door_page_serves_the_employee_entry_point(make_harness, tmp_path):
    r = _entry(make_harness, tmp_path).client().get("/door")
    assert r.status_code == 200
    assert "angajat" in r.text  # pagina explicativă a unui telefon neconfigurat vine tot din interfață, nu JSON


def test_door_with_token_sets_cookie_then_redirects_to_door(make_harness, tmp_path):
    h = _entry(make_harness, tmp_path)
    c = h.client()
    r = c.get(f"/door?k={KIOSK_TOKEN}", follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/door"
    assert "gym_kiosk" in r.headers["set-cookie"]
    # tokenul rămâne în cookie: codul se cere fără ?k=
    assert c.get("/api/employee/door/qr").status_code == 200


def test_door_with_wrong_token_gets_an_explanatory_page_not_json(make_harness, tmp_path):
    r = _entry(make_harness, tmp_path).client().get("/door?k=gresit")
    assert r.status_code == 403
    assert "text/html" in r.headers["content-type"]
    assert "angajat" in r.text


def test_door_token_setup_works_without_a_built_frontend(harness):
    r = harness.client().get(f"/door?k={KIOSK_TOKEN}", follow_redirects=False)
    assert r.status_code == 303


def test_door_qr_without_kiosk_token_is_not_configured(harness):
    r = harness.client().get("/api/employee/door/qr")
    assert r.status_code == 403
    assert r.json()["reason"] == "door_not_configured"
    assert r.json()["detail"]


def test_door_qr_with_wrong_cookie_is_invalid_token(harness):
    c = harness.client()
    c.cookies.set("gym_kiosk", "gresit")
    r = c.get("/api/employee/door/qr")
    assert r.status_code == 403
    assert r.json()["reason"] == "door_token_invalid"


def test_door_is_not_configured_when_server_has_no_kiosk_token(make_harness):
    c = make_harness(kiosk_token="").client()
    c.cookies.set("gym_kiosk", "orice")
    assert c.get("/api/employee/door/qr").json()["reason"] == "door_not_configured"


def test_door_qr_returns_svg_period_and_seconds_remaining(harness):
    # ceasul de test e 08:12:00 UTC: fereastra de 30 s abia a început
    body = harness.kiosk_client().get("/api/employee/door/qr").json()
    assert body["svg"].startswith("<svg")
    assert body["period_seconds"] == 30
    assert body["remaining_seconds"] == 30
    harness.clock.advance(seconds=12)
    assert harness.kiosk_client().get("/api/employee/door/qr").json()["remaining_seconds"] == 18


def test_qr_changes_every_30_seconds_without_intervention(harness):
    first = harness.door_url()
    harness.clock.advance(seconds=30)
    assert harness.door_url() != first


def test_qr_points_to_employee_page_with_totp(harness):
    url = harness.door_url()
    assert "/me?t=" in url


def test_employee_page_from_qr_is_served_without_identity_check(make_harness, tmp_path):
    (tmp_path / "index.html").write_text("<title>admin</title>")
    (tmp_path / "employee.html").write_text("<title>angajat</title>")
    h = make_harness(frontend_dist=str(tmp_path))
    assert h.client().get(f"/me?t={h.current_totp()}").status_code == 200


def test_entry_without_totp_is_rejected_with_clear_message(harness):
    phone = harness.enrolled_client("Ana Pop")
    r = phone.post("/api/employee/entry")
    assert r.status_code == 403
    assert "Scanează" in r.json()["detail"]
    assert phone.get("/api/employee/me").json()["inside_since"] is None


def test_wrong_totp_is_rejected(harness):
    phone = harness.enrolled_client("Ana Pop")
    r = phone.post("/api/employee/entry", json={"totp": "00000000"})
    assert r.status_code == 403
    assert "Scanează QR-ul de la ușă" in r.text


def test_expired_totp_is_rejected(harness):
    phone = harness.enrolled_client("Ana Pop")
    totp = harness.current_totp()
    harness.clock.advance(seconds=65)
    r = phone.post("/api/employee/entry", json={"totp": totp})
    assert r.status_code == 403
    assert "expirat" in r.text


def test_previous_window_totp_is_accepted(harness):
    phone = harness.enrolled_client("Ana Pop")
    totp = harness.current_totp()
    harness.clock.advance(seconds=30)
    assert phone.post("/api/employee/entry", json={"totp": totp}).status_code == 200


def test_two_employees_can_use_same_qr_in_same_window(harness):
    ana = harness.enrolled_client("Ana Pop")
    ion = harness.enrolled_client("Ion Vasile")
    totp = harness.current_totp()
    assert ana.post("/api/employee/entry", json={"totp": totp}).status_code == 200
    assert ion.post("/api/employee/entry", json={"totp": totp}).status_code == 200


def test_same_employee_can_reuse_totp_for_exit(harness):
    phone = harness.enrolled_client("Ana Pop")
    totp = harness.current_totp()
    phone.post("/api/employee/entry", json={"totp": totp})
    assert phone.post("/api/employee/exit", json={"totp": totp}).status_code == 200


def test_client_sent_timestamp_is_ignored(harness):
    phone = harness.enrolled_client("Ana Pop")
    totp = harness.current_totp()
    harness.clock.advance(minutes=5)
    r = phone.post("/api/employee/entry", json={"totp": totp, "timestamp": "2026-01-05T08:17:00Z",
                                       "ts": "1767601020", "t": totp},
                   headers={"Date": "Mon, 05 Jan 2026 08:17:00 GMT"})
    assert r.status_code == 403


def test_totp_depends_on_server_secret(make_harness):
    a = make_harness(totp_secret="alfa")
    b = make_harness(totp_secret="beta")
    assert a.current_totp() != b.current_totp()


def test_entry_records_qr_totp_method_in_journal(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/api/employee/entry", json={"totp": harness.current_totp()})
    page = harness.admin_client().get("/api/admin/journal").text
    assert "Cod QR" in page


def test_non_ascii_totp_is_refused_not_a_server_error(harness):
    phone = harness.enrolled_client("Ana Pop")
    r = phone.post("/api/employee/entry", json={"totp": "é"})
    assert r.status_code == 403
    assert "greșit" in r.text


def test_non_ascii_kiosk_token_in_url_is_refused(make_harness, tmp_path):
    assert _entry(make_harness, tmp_path).client().get("/door?k=é").status_code == 403


def test_non_ascii_kiosk_cookie_is_refused(harness):
    r = harness.client().get("/api/employee/door/qr", headers={"Cookie": "gym_kiosk=é".encode("utf-8")})
    assert r.status_code == 403
