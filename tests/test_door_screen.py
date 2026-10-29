"""Ecranul de la ușă: Activare din aplicație și QR TOTP. Ceasul de test: 08:12:00 UTC."""

from tests.conftest import HALL_IP, OUTSIDE_IP


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


def test_activation_page_is_served_by_the_employee_entry_point(make_harness, tmp_path):
    r = _entry(make_harness, tmp_path).client().get("/door/activate/abc")
    assert r.status_code == 200
    assert "angajat" in r.text


def test_door_qr_requires_an_activated_phone(harness):
    r = harness.client().get("/api/employee/door/qr")
    assert r.status_code == 403
    assert r.json()["reason"] == "door_not_configured"
    assert r.json()["detail"]


def test_door_qr_with_unknown_cookie_is_invalid(harness):
    harness.door_client()
    c = harness.client()
    c.cookies.set("gc_door", "gresit")
    r = c.get("/api/employee/door/qr")
    assert r.status_code == 403
    assert r.json()["reason"] == "door_token_invalid"


def test_non_ascii_door_cookie_is_refused(harness):
    r = harness.client().get("/api/employee/door/qr", headers={"Cookie": "gc_door=é".encode("utf-8")})
    assert r.status_code == 403


def test_door_screen_status_requires_admin(harness):
    assert harness.client().get("/api/admin/door-screen").status_code == 401
    assert harness.client().post("/api/admin/door-screen/activation-link").status_code == 401


def test_status_is_inactive_before_and_active_since_after_activation(harness):
    admin = harness.admin_client()
    assert admin.get("/api/admin/door-screen").json() == {
        "active": False, "activated_at": None, "timezone": "Europe/Bucharest"}
    harness.door_client()
    assert admin.get("/api/admin/door-screen").json() == {
        "active": True, "activated_at": "2026-01-05 10:12", "timezone": "Europe/Bucharest"}


def test_issued_link_carries_qr_and_lasts_48_hours(harness):
    r = harness.admin_client().post("/api/admin/door-screen/activation-link")
    body = r.json()
    assert "/door/activate/" in body["link"]
    assert body["qr_svg"].startswith("<svg")
    assert body["hours"] == 48


def test_opening_the_link_does_not_consume_it_but_the_button_does(harness):
    link = "/api/employee" + harness.issue_door_link()
    phone = harness.client()
    assert phone.get(link).status_code == 200
    assert phone.get(link).status_code == 200
    assert phone.post(link).status_code == 200
    again = harness.client()
    assert again.get(link).status_code == 410
    r = again.post(link)
    assert r.status_code == 410
    assert r.json()["reason"] == "link_invalid"


def test_link_expires_after_48_hours(harness):
    link = "/api/employee" + harness.issue_door_link()
    harness.clock.advance(hours=47)
    assert harness.client().get(link).status_code == 200
    harness.clock.advance(hours=2)
    assert harness.client().get(link).status_code == 410
    assert harness.client().post(link).status_code == 410


def test_unknown_link_is_invalid(harness):
    r = harness.client().get("/api/employee/door/activate/inexistent")
    assert r.status_code == 410
    assert r.json()["reason"] == "link_invalid"


def test_activation_outside_hall_network_is_rejected_and_keeps_the_link(harness):
    link = "/api/employee" + harness.issue_door_link()
    r = harness.client(OUTSIDE_IP).post(link)
    assert r.status_code == 403
    assert r.json()["reason"] == "not_in_hall_network"
    assert harness.client().post(link).status_code == 200


def test_opening_the_link_outside_the_hall_still_shows_the_confirmation(harness):
    link = "/api/employee" + harness.issue_door_link()
    assert harness.client(OUTSIDE_IP).get(link).status_code == 200


def test_activated_phone_gets_the_qr_while_others_do_not(harness):
    phone = harness.door_client()
    assert phone.get("/api/employee/door/qr").status_code == 200
    assert harness.client().get("/api/employee/door/qr").json()["reason"] == "door_not_configured"


def test_activation_is_in_the_journal_with_the_author(harness):
    harness.door_client()
    entries = harness.admin_client().get("/api/admin/journal").json()["entries"]
    activation = [e for e in entries if "Ecranul de la ușă activat" in e["summary"]]
    assert len(activation) == 1
    assert activation[0]["kind_label"] == "Acțiune Admin"
    assert activation[0]["author"] == "admin"


def test_new_activation_retires_the_previous_phone(harness):
    old = harness.door_client()
    new = harness.door_client()
    assert new.get("/api/employee/door/qr").status_code == 200
    r = old.get("/api/employee/door/qr")
    assert r.status_code == 403
    assert r.json()["reason"] == "door_token_invalid"


def test_new_link_does_not_retire_the_phone_until_it_is_used(harness):
    phone = harness.door_client()
    harness.issue_door_link()
    assert phone.get("/api/employee/door/qr").status_code == 200


def test_door_screen_stays_active_after_a_server_restart(make_harness, tmp_path):
    db = str(tmp_path / "gym.db")
    first = make_harness(database=db)
    phone = first.door_client()
    cookie = phone.cookies.get("gc_door")
    second = make_harness(database=db)
    c = second.client()
    c.cookies.set("gc_door", cookie)
    assert c.get("/api/employee/door/qr").status_code == 200
    assert second.admin_client().get("/api/admin/door-screen").json()["active"] is True


def test_door_qr_returns_svg_period_and_seconds_remaining(harness):
    # ceasul de test e 08:12:00 UTC: fereastra de 30 s abia a început
    body = harness.door_client().get("/api/employee/door/qr").json()
    assert body["svg"].startswith("<svg")
    assert body["period_seconds"] == 30
    assert body["remaining_seconds"] == 30
    harness.clock.advance(seconds=12)
    assert harness.door_client().get("/api/employee/door/qr").json()["remaining_seconds"] == 18


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


def test_replaced_link_is_invalid_while_the_newer_one_works(harness):
    old = "/api/employee" + harness.issue_door_link()
    new = "/api/employee" + harness.issue_door_link()
    phone = harness.client()
    assert phone.get(old).status_code == 410
    r = phone.post(old)
    assert r.status_code == 410
    assert r.json()["reason"] == "link_invalid"
    assert phone.post(new).status_code == 200


def test_outside_hall_rejection_tells_to_connect_to_hall_wifi(harness):
    link = "/api/employee" + harness.issue_door_link()
    r = harness.client(OUTSIDE_IP).post(link)
    assert "Wi-Fi" in r.json()["detail"]
