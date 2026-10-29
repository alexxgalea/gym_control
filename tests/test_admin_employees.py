"""Angajați (API JSON `/api/admin/employees`): listă, adăugare, link de înrolare, revocare."""


def create(c, name, email, **kw):
    return c.post("/api/admin/employees", json={"name": name, "email": email}, **kw)


def test_every_employee_endpoint_requires_login(harness):
    eid = harness.create_employee("Ana Pop")
    c = harness.client()
    assert c.get("/api/admin/employees").status_code == 401
    assert create(c, "Bob", "bob@firma.ro").status_code == 401
    assert c.post(f"/api/admin/employees/{eid}/enroll-link").status_code == 401
    assert c.post(f"/api/admin/employees/{eid}/revoke").status_code == 401
    assert [e["name"] for e in harness.admin_client().get("/api/admin/employees").json()] == ["Ana Pop"]


def test_admin_creates_employee_and_sees_it_listed(harness):
    c = harness.admin_client()
    r = create(c, "  Ana   Pop ", "Ana.Pop@Firma.ro")
    assert r.status_code == 201
    assert r.json() == {"id": r.json()["id"], "name": "Ana Pop", "email": "ana.pop@firma.ro", "enrolled": False}
    assert c.get("/api/admin/employees").json() == [r.json()]


def test_list_is_sorted_by_name_and_shows_enrolment_state(harness):
    harness.create_employee("Ion Vasile")
    eid = harness.create_employee("Ana Pop")
    harness.enroll(harness.issue_enroll_link(eid))
    rows = harness.admin_client().get("/api/admin/employees").json()
    assert [(e["name"], e["enrolled"]) for e in rows] == [("Ana Pop", True), ("Ion Vasile", False)]


def test_create_rejects_invalid_email_and_empty_name_with_the_offending_field(harness):
    c = harness.admin_client()
    r = create(c, "Ana", "nu-e-email")
    assert r.status_code == 400
    assert r.json() == {"detail": "Email invalid", "field": "email"}
    r = create(c, "  ", "ana@firma.ro")
    assert r.status_code == 400
    assert r.json() == {"detail": "Numele lipsește", "field": "name"}
    r = c.post("/api/admin/employees", json={})
    assert r.status_code == 400
    assert c.get("/api/admin/employees").json() == []


def test_create_rejects_duplicate_email(harness):
    c = harness.admin_client()
    create(c, "Ana", "ana@firma.ro")
    r = create(c, "Altă Ana", "ANA@firma.ro")
    assert r.status_code == 400
    assert r.json() == {"detail": "Email deja existent", "field": "email"}
    assert [e["name"] for e in c.get("/api/admin/employees").json()] == ["Ana"]


def test_enroll_link_returns_link_name_and_validity_and_opens_enrollment(harness):
    eid = harness.create_employee("Ana Pop")
    r = harness.admin_client().post(f"/api/admin/employees/{eid}/enroll-link")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Ana Pop" and body["hours"] == 48
    assert body["link"].startswith("http://testserver/enroll/")
    assert harness.client().get(body["link"].removeprefix("http://testserver")).status_code == 200


def test_unknown_employee_is_404_for_link_and_revoke(harness):
    c = harness.admin_client()
    for action in ("enroll-link", "revoke"):
        r = c.post(f"/api/admin/employees/999/{action}")
        assert r.status_code == 404 and r.json() == {"detail": "Angajat inexistent"}


def test_revoke_marks_employee_not_enrolled(harness):
    eid = harness.create_employee("Ana Pop")
    harness.enroll(harness.issue_enroll_link(eid))
    c = harness.admin_client()
    assert c.get("/api/admin/employees").json()[0]["enrolled"] is True
    assert c.post(f"/api/admin/employees/{eid}/revoke").status_code == 204
    assert c.get("/api/admin/employees").json()[0]["enrolled"] is False


def test_admin_actions_appear_in_jurnal_with_author(harness):
    c = harness.admin_client()
    eid = create(c, "Ana Pop", "ana@firma.ro").json()["id"]
    c.post(f"/api/admin/employees/{eid}/enroll-link")
    c.post(f"/api/admin/employees/{eid}/revoke")
    page = c.get("/api/admin/journal").text
    assert "Angajat creat: Ana Pop" in page
    assert "Link de înrolare generat pentru Ana Pop" in page
    assert "Dispozitiv revocat pentru Ana Pop" in page
    assert page.count("admin") >= 3  # autorul apare pe linii
    assert "2026-01-05T08:12:00+00:00" in page  # ceasul injectat, UTC


def test_failed_attempts_do_not_write_created_entries(harness):
    c = harness.admin_client()
    create(c, "Ana", "nu-e-email")
    assert "Angajat creat" not in c.get("/api/admin/journal").text
