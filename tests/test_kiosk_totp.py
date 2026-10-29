"""Kiosk `/door` cu QR TOTP. Ceasul de test: 08:12:00 UTC."""

from tests.conftest import KIOSK_TOKEN


def _door_totp(h):
    return h.current_totp()


def test_door_without_kiosk_token_is_refused(harness):
    assert harness.client().get("/door").status_code == 403


def test_door_with_wrong_token_is_refused(harness):
    assert harness.client().get("/door?k=gresit").status_code == 403


def test_door_with_token_shows_inline_svg_qr_and_remembers_token(harness):
    c = harness.client()
    r = c.get(f"/door?k={KIOSK_TOKEN}", follow_redirects=True)
    assert r.status_code == 200
    assert "<svg" in r.text
    # tokenul rămâne în cookie: a doua cerere nu mai are nevoie de ?k=
    assert c.get("/door").status_code == 200


def test_qr_changes_every_30_seconds_without_intervention(harness):
    first = harness.door_url()
    harness.clock.advance(seconds=30)
    assert harness.door_url() != first


def test_qr_fragment_endpoint_for_auto_renew_is_protected(harness):
    assert harness.client().get("/door/qr").status_code == 403
    k = harness.kiosk_client()
    before = k.get("/door/qr").text
    harness.clock.advance(seconds=30)
    assert k.get("/door/qr").text != before


def test_qr_points_to_employee_page_with_totp(harness):
    url = harness.door_url()
    assert "/me?t=" in url


def test_employee_page_from_qr_keeps_totp_in_hidden_field(harness):
    phone = harness.enrolled_client("Ana Pop")
    totp = harness.current_totp()
    page = phone.get(f"/me?t={totp}").text
    assert f'name="totp" value="{totp}"' in page


def test_entry_without_totp_is_rejected_with_clear_message(harness):
    phone = harness.enrolled_client("Ana Pop")
    r = phone.post("/me/entry")
    assert r.status_code == 403
    assert "Scanează QR-ul de la ușă" in r.text
    assert "în afara Sălii" in phone.get("/me").text


def test_wrong_totp_is_rejected(harness):
    phone = harness.enrolled_client("Ana Pop")
    r = phone.post("/me/entry", data={"totp": "00000000"})
    assert r.status_code == 403
    assert "Scanează QR-ul de la ușă" in r.text


def test_expired_totp_is_rejected(harness):
    phone = harness.enrolled_client("Ana Pop")
    totp = harness.current_totp()
    harness.clock.advance(seconds=65)
    r = phone.post("/me/entry", data={"totp": totp})
    assert r.status_code == 403
    assert "expirat" in r.text


def test_previous_window_totp_is_accepted(harness):
    phone = harness.enrolled_client("Ana Pop")
    totp = harness.current_totp()
    harness.clock.advance(seconds=30)
    assert phone.post("/me/entry", data={"totp": totp}).status_code == 200


def test_two_employees_can_use_same_qr_in_same_window(harness):
    ana = harness.enrolled_client("Ana Pop")
    ion = harness.enrolled_client("Ion Vasile")
    totp = harness.current_totp()
    assert ana.post("/me/entry", data={"totp": totp}).status_code == 200
    assert ion.post("/me/entry", data={"totp": totp}).status_code == 200


def test_same_employee_can_reuse_totp_for_exit(harness):
    phone = harness.enrolled_client("Ana Pop")
    totp = harness.current_totp()
    phone.post("/me/entry", data={"totp": totp})
    assert phone.post("/me/exit", data={"totp": totp}).status_code == 200


def test_client_sent_timestamp_is_ignored(harness):
    phone = harness.enrolled_client("Ana Pop")
    totp = harness.current_totp()
    harness.clock.advance(minutes=5)
    r = phone.post("/me/entry", data={"totp": totp, "timestamp": "2026-01-05T08:17:00Z",
                                       "ts": "1767601020", "t": totp},
                   headers={"Date": "Mon, 05 Jan 2026 08:17:00 GMT"})
    assert r.status_code == 403


def test_totp_depends_on_server_secret(make_harness):
    a = make_harness(totp_secret="alfa")
    b = make_harness(totp_secret="beta")
    assert a.current_totp() != b.current_totp()


def test_entry_records_qr_totp_method_in_journal(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data={"totp": harness.current_totp()})
    page = harness.admin_client().get("/api/admin/journal").text
    assert "Cod QR" in page


def test_non_ascii_totp_is_refused_not_a_server_error(harness):
    phone = harness.enrolled_client("Ana Pop")
    r = phone.post("/me/entry", data={"totp": "é"})
    assert r.status_code == 403
    assert "greșit" in r.text


def test_non_ascii_kiosk_token_in_url_is_refused(harness):
    assert harness.client().get("/door?k=é").status_code == 403


def test_non_ascii_kiosk_cookie_is_refused(harness):
    r = harness.client().get("/door", headers={"Cookie": "gym_kiosk=é".encode("utf-8")})
    assert r.status_code == 403
