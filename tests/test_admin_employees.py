"""Angajați (API JSON `/api/admin/employees`): listă, adăugare, link de înrolare, revocare, import CSV."""

import io

from gym_control import door

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
    assert harness.client().get("/api/employee" + body["link"].removeprefix("http://testserver")).status_code == 200


def test_enroll_link_includes_qr_svg_of_the_link(harness):
    eid = harness.create_employee("Ana Pop")
    body = harness.admin_client().post(f"/api/admin/employees/{eid}/enroll-link").json()
    assert body["qr_svg"].startswith("<svg") and body["qr_svg"].rstrip().endswith("</svg>")
    assert body["qr_svg"] == door.qr_svg(body["link"])


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


# --- Import CSV (POST /api/admin/employees/import, multipart) ---


def import_csv(c, text: str, **kw):
    return c.post(
        "/api/admin/employees/import",
        files={"file": ("angajati.csv", io.BytesIO(text.encode("utf-8")), "text/csv")},
        **kw,
    )


def names(c):
    return [e["name"] for e in c.get("/api/admin/employees").json()]


def test_csv_import_creates_valid_rows_and_reports_invalid_ones_with_row_numbers(harness):
    c = harness.admin_client()
    csv_text = (
        "nume,email\n"
        "Ana Pop,ana@firma.ro\n"
        "Bogdan,nu-e-email\n"
        ",gol@firma.ro\n"
        "Ana Duplicat,ANA@firma.ro\n"
        "Ion Vasile,ion@firma.ro\n"
        "Doar o coloana\n"
    )
    r = import_csv(c, csv_text)
    assert r.status_code == 200
    assert r.json() == {
        "created": 2,
        "errors": [
            "Rândul 3: email invalid.",
            "Rândul 4: numele lipsește.",
            "Rândul 5: email deja existent.",
            "Rândul 7: se așteaptă două coloane (nume, email).",
        ],
    }
    assert names(c) == ["Ana Pop", "Ion Vasile"]


def test_csv_import_handles_300_rows(harness):
    c = harness.admin_client()
    rows = "\n".join(f"Angajat {i},angajat{i}@firma.ro" for i in range(300))
    r = import_csv(c, "nume,email\n" + rows + "\n")
    assert r.json() == {"created": 300, "errors": []}
    assert "Angajat 299" in names(c)


def test_csv_import_accepts_semicolons_bom_and_missing_trailing_newline(harness):
    c = harness.admin_client()
    r = import_csv(c, "﻿Nume;Email\nAna;ana@firma.ro\nIon;ion@firma.ro")
    assert r.json() == {"created": 2, "errors": []}


def test_csv_import_rejects_file_without_expected_header(harness):
    c = harness.admin_client()
    r = import_csv(c, "foo,bar\nAna,ana@firma.ro\n")
    assert r.status_code == 400
    assert "antet" in r.json()["detail"]
    assert names(c) == []


def test_csv_import_requires_login(harness):
    r = import_csv(harness.client(), "nume,email\nAna,ana@firma.ro\n")
    assert r.status_code == 401
    assert names(harness.admin_client()) == []


def test_csv_import_appears_in_jurnal_with_author(harness):
    c = harness.admin_client()
    import_csv(c, "nume,email\nIon,ion@firma.ro\nRău,rau\n")
    page = c.get("/api/admin/journal").text
    assert "Angajat importat din CSV: Ion" in page
    assert "Import CSV: 1 importați, 1 respinse" in page
    assert page.count("admin") >= 2
    assert "2026-01-05T08:12:00+00:00" in page
