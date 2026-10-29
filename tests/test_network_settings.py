"""Validare de rețea și ecranul Setări (#7)."""

from tests.conftest import OUTSIDE_IP


def test_entry_and_exit_from_outside_subnet_are_rejected_with_message(harness):
    phone = harness.enrolled_client("Ana Pop")
    outside = harness.client(OUTSIDE_IP)
    outside.cookies.update(phone.cookies)
    r = outside.post("/me/entry", data={"totp": harness.current_totp()})
    assert r.status_code == 403
    assert "rețeaua Sălii" in r.text
    phone.post("/me/entry", data={"totp": harness.current_totp()})
    assert outside.post("/me/exit", data={"totp": harness.current_totp()}).status_code == 403
    assert "în Sală din" in phone.get("/me").text  # Ieșirea nu a fost înregistrată


def test_entry_from_inside_subnet_is_accepted(harness):
    assert harness.enrolled_client("Ana Pop").post("/me/entry", data={"totp": harness.current_totp()}).status_code == 200


def test_enrollment_post_outside_subnet_is_rejected_and_link_stays_usable(harness):
    link = harness.issue_enroll_link(harness.create_employee("Ana Pop"))
    outside = harness.client(OUTSIDE_IP)
    r = outside.post(link, follow_redirects=False)
    assert r.status_code == 403
    assert "rețeaua Sălii" in r.text
    assert "gc_device" not in outside.cookies
    assert harness.enroll(link).post("/me/entry", data={"totp": harness.current_totp()}).status_code == 200


def test_admin_screens_are_not_restricted_by_subnet(harness):
    assert harness.admin_client(OUTSIDE_IP).get("/admin/settings").status_code == 200


def test_settings_screen_requires_admin(harness):
    r = harness.client().get("/admin/settings", follow_redirects=False)
    assert r.status_code in (303, 401)


def test_settings_screen_shows_defaults_from_configuration(make_harness):
    h = make_harness(hall_subnet="172.16.0.0/16")
    page = h.admin_client().get("/admin/settings").text
    assert 'value="172.16.0.0/16"' in page
    assert 'value="06:00"' in page
    assert 'value="22:00"' in page
    assert 'href="/admin/settings"' in page


def test_changing_subnet_applies_immediately(harness):
    phone = harness.enrolled_client("Ana Pop")
    admin = harness.admin_client()
    r = admin.post("/admin/settings", follow_redirects=False,
                   data={"hall_subnet": "10.0.0.0/24", "opening_time": "06:00", "closing_time": "22:00"})
    assert r.status_code == 303
    assert 'value="10.0.0.0/24"' in admin.get("/admin/settings").text
    # telefonul din vechea subrețea este acum respins, cel din noua subrețea acceptat
    assert phone.post("/me/entry", data={"totp": harness.current_totp()}).status_code == 403
    phone_new = harness.client(OUTSIDE_IP)
    phone_new.cookies.update(phone.cookies)
    assert phone_new.post("/me/entry", data={"totp": harness.current_totp()}).status_code == 200
    assert "în rețeaua Sălii" in harness.client(OUTSIDE_IP).get("/status").text


def test_changing_times_is_stored_and_shown(harness):
    admin = harness.admin_client()
    r = admin.post("/admin/settings", follow_redirects=False,
                   data={"hall_subnet": "192.168.10.0/24", "opening_time": "07:30", "closing_time": "21:15"})
    assert r.status_code == 303
    page = admin.get("/admin/settings").text
    assert 'value="07:30"' in page and 'value="21:15"' in page


def test_invalid_values_are_rejected_with_clear_errors_and_nothing_saved(harness):
    admin = harness.admin_client()
    r = admin.post("/admin/settings",
                   data={"hall_subnet": "nu-e-ip", "opening_time": "25:99", "closing_time": "abc"})
    assert r.status_code == 400
    assert "Subrețea invalidă" in r.text
    assert "Ora de deschidere invalidă" in r.text
    assert "Ora de închidere invalidă" in r.text
    page = admin.get("/admin/settings").text
    assert 'value="192.168.10.0/24"' in page


def test_opening_must_be_before_closing(harness):
    r = harness.admin_client().post(
        "/admin/settings",
        data={"hall_subnet": "192.168.10.0/24", "opening_time": "22:00", "closing_time": "06:00"})
    assert r.status_code == 400
    assert "înainte de ora de închidere" in r.text


def test_settings_changes_are_journaled_with_author(harness):
    admin = harness.admin_client()
    admin.post("/admin/settings", data={"hall_subnet": "10.1.0.0/16", "opening_time": "06:00",
                                         "closing_time": "20:00"})
    page = admin.get("/admin/jurnal").text
    assert "Setări modificate" in page
    assert "10.1.0.0/16" in page and "20:00" in page
    assert "admin" in page


def test_saving_unchanged_settings_writes_no_journal_line(harness):
    admin = harness.admin_client()
    admin.post("/admin/settings", data={"hall_subnet": "192.168.10.0/24", "opening_time": "06:00",
                                         "closing_time": "22:00"})
    assert "Setări modificate" not in admin.get("/admin/jurnal").text


def test_settings_screen_is_mobile_friendly(harness):
    page = harness.admin_client().get("/admin/settings").text
    assert 'name="viewport"' in page
    assert 'class="card stack"' in page
