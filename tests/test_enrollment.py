from tests.conftest import OUTSIDE_IP


def api(link: str) -> str:
    return "/api/employee" + link


def test_link_name_is_read_from_the_link(harness):
    link = harness.issue_enroll_link(harness.create_employee("Ana Pop"))
    r = harness.client().get(api(link))
    assert r.status_code == 200
    assert r.json() == {"name": "Ana Pop"}


def test_activation_sets_the_phone_cookie_with_unchanged_attributes(harness):
    link = harness.issue_enroll_link(harness.create_employee("Ana Pop"))
    r = harness.client().post(api(link))
    assert r.status_code == 200
    assert r.json() == {"name": "Ana Pop"}
    cookie = r.headers["set-cookie"].lower()
    assert cookie.startswith("gc_device=")
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert f"max-age={2 * 365 * 24 * 3600}" in cookie


def test_activation_outside_hall_network_is_403_and_link_stays_usable(harness):
    link = harness.issue_enroll_link(harness.create_employee("Ana Pop"))
    r = harness.client(OUTSIDE_IP).post(api(link))
    assert r.status_code == 403
    assert r.json()["reason"] == "not_in_hall_network"
    assert harness.client().post(api(link)).status_code == 200


def test_reading_the_link_does_not_require_hall_network(harness):
    link = harness.issue_enroll_link(harness.create_employee("Ana Pop"))
    assert harness.client(OUTSIDE_IP).get(api(link)).status_code == 200


def test_enroll_page_serves_the_employee_entry_point(make_harness, tmp_path):
    (tmp_path / "index.html").write_text("<title>admin</title>")
    (tmp_path / "employee.html").write_text("<title>angajat</title>")
    r = make_harness(frontend_dist=str(tmp_path)).client().get("/enroll/orice-token")
    assert r.status_code == 200
    assert "angajat" in r.text


def test_enrolled_phone_is_identified_by_cookie(harness):
    phone = harness.enrolled_client("Ana Pop")
    r = phone.get("/api/employee/me")
    assert r.status_code == 200
    assert "Ana Pop" in r.text


def test_employee_without_cookie_is_told_to_enrol(harness):
    r = harness.client().get("/api/employee/me")
    assert r.status_code == 401
    assert r.json()["reason"] == "phone_not_activated"


def test_link_works_only_once(harness):
    eid = harness.create_employee("Ana Pop")
    link = harness.issue_enroll_link(eid)
    harness.enroll(link)
    second = harness.client()
    assert second.get(api(link)).status_code == 410
    r = second.post(api(link))
    assert r.status_code == 410
    assert r.json()["reason"] == "link_invalid"
    assert second.get("/api/employee/me").status_code == 401


def test_opening_link_without_confirming_does_not_consume_it(harness):
    link = harness.issue_enroll_link(harness.create_employee("Ana Pop"))
    harness.client().get(api(link))  # ex. previzualizare de mesagerie
    assert "Ana Pop" in harness.enroll(link).get("/api/employee/me").text


def test_unknown_link_is_rejected(harness):
    r = harness.client().get("/api/employee/enroll/nu-exista")
    assert r.status_code == 410
    assert r.json()["reason"] == "link_invalid"
    assert r.json()["detail"]


def test_link_expires(harness):
    link = harness.issue_enroll_link(harness.create_employee("Ana Pop"))
    harness.clock.advance(days=3)
    assert harness.client().get(api(link)).status_code == 410


def test_cookie_identifies_the_right_employee(harness):
    ana = harness.enrolled_client("Ana Pop")
    ion = harness.enrolled_client("Ion Vasile")
    assert "Ana Pop" in ana.get("/api/employee/me").text
    assert "Ion Vasile" in ion.get("/api/employee/me").text
    assert "Ion Vasile" not in ana.get("/api/employee/me").text


def test_client_sent_id_is_ignored(harness):
    harness.enrolled_client("Ion Vasile")
    stranger = harness.client()
    assert stranger.get("/api/employee/me?employee_id=1").status_code == 401
    assert stranger.get("/api/employee/me", headers={"X-Employee-Id": "1"}).status_code == 401


def test_forged_cookie_is_rejected(harness):
    c = harness.client()
    c.cookies.set("gc_device", "inventat")
    assert c.get("/api/employee/me").status_code == 401


def test_re_enrolment_invalidates_old_device(harness):
    eid = harness.create_employee("Ana Pop")
    old = harness.enroll(harness.issue_enroll_link(eid))
    new = harness.enroll(harness.issue_enroll_link(eid))
    assert old.get("/api/employee/me").status_code == 401
    assert "Ana Pop" in new.get("/api/employee/me").text


def test_issuing_new_link_voids_previous_unused_link(harness):
    eid = harness.create_employee("Ana Pop")
    first = harness.issue_enroll_link(eid)
    second = harness.issue_enroll_link(eid)
    assert harness.client().get(api(first)).status_code == 410
    assert harness.client().get(api(second)).status_code == 200


def test_revocation_invalidates_device(harness):
    eid = harness.create_employee("Ana Pop")
    phone = harness.enroll(harness.issue_enroll_link(eid))
    r = harness.admin_client().post(f"/api/admin/employees/{eid}/revoke")
    assert r.status_code == 204
    assert phone.get("/api/employee/me").status_code == 401


def test_enrol_screens_require_admin(harness):
    eid = harness.create_employee("Ana Pop")
    c = harness.client()
    for path in (f"/api/admin/employees/{eid}/enroll-link", f"/api/admin/employees/{eid}/revoke"):
        assert c.post(path).status_code == 401


def test_admin_enrolment_actions_are_in_journal_with_author(harness):
    eid = harness.create_employee("Ana Pop")
    admin = harness.admin_client()
    harness.enroll(harness.issue_enroll_link(eid, admin))
    admin.post(f"/api/admin/employees/{eid}/revoke")
    page = admin.get("/api/admin/journal").text
    assert "Activare telefon: link generat pentru Ana Pop" in page
    assert "Telefon scos din uz: Ana Pop" in page
    assert "Telefon activat: Ana Pop" in page
