"""Validare de rețea și ecranul Setări (#7)."""

from tests.conftest import HALL_IP, OUTSIDE_IP


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
    page = admin.get("/api/admin/journal").text
    assert "Setări modificate" in page
    assert "10.1.0.0/16" in page and "20:00" in page
    assert "admin" in page


def test_saving_unchanged_settings_writes_no_journal_line(harness):
    admin = harness.admin_client()
    admin.post("/admin/settings", data={"hall_subnet": "192.168.10.0/24", "opening_time": "06:00",
                                         "closing_time": "22:00"})
    assert "Setări modificate" not in admin.get("/api/admin/journal").text


def test_settings_screen_is_mobile_friendly(harness):
    page = harness.admin_client().get("/admin/settings").text
    assert 'name="viewport"' in page
    assert 'class="card stack"' in page


def test_forwarded_for_is_ignored_by_default(harness):
    enrolled = harness.enrolled_client("Ana Pop")
    phone = harness.client(OUTSIDE_IP)
    phone.cookies.update(enrolled.cookies)
    r = phone.post("/me/entry", data={"totp": harness.current_totp()},
                   headers={"X-Forwarded-For": HALL_IP})
    assert r.status_code == 403


def test_forwarded_for_is_honoured_only_from_trusted_proxy(make_harness):
    h = make_harness(trusted_proxies=(OUTSIDE_IP,))
    phone = h.enrolled_client("Ana Pop")
    proxy = h.client(OUTSIDE_IP)
    proxy.cookies.update(phone.cookies)
    totp = {"totp": h.current_totp()}
    # proxy de încredere: se folosește adresa din X-Forwarded-For (clientul real)
    assert proxy.post("/me/entry", data=totp, headers={"X-Forwarded-For": HALL_IP}).status_code == 200
    assert proxy.post("/me/exit", data=totp, headers={"X-Forwarded-For": "10.9.9.9"}).status_code == 403
    # un client oarecare nu poate falsifica antetul
    stranger = h.client("10.7.7.7")
    stranger.cookies.update(phone.cookies)
    assert stranger.post("/me/exit", data=totp, headers={"X-Forwarded-For": HALL_IP}).status_code == 403
    # un X-Forwarded-For falsificat de client, adăugat în față de proxy, nu contează (se ia ultima adresă necunoscută)
    assert proxy.post("/me/exit", data=totp,
                      headers={"X-Forwarded-For": f"{HALL_IP}, 10.9.9.9"}).status_code == 403
