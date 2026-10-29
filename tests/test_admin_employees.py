import io


def create(c, name, email):
    return c.post("/admin/employees", data={"name": name, "email": email}, follow_redirects=False)


def import_csv(c, text: str, **kw):
    return c.post(
        "/admin/employees/import",
        files={"file": ("angajati.csv", io.BytesIO(text.encode("utf-8")), "text/csv")},
        **kw,
    )


def test_create_requires_login(harness):
    r = create(harness.client(), "Ana", "ana@firma.ro")
    assert r.status_code == 303
    assert r.headers["location"] == "/admin/login"
    assert "Ana" not in harness.admin_client().get("/admin/employees").text


def test_admin_creates_employee_and_sees_it_listed(harness):
    c = harness.admin_client()
    r = create(c, "Ana Pop", "Ana.Pop@Firma.ro")
    assert r.status_code == 303
    page = c.get("/admin/employees").text
    assert "Ana Pop" in page
    assert "ana.pop@firma.ro" in page


def test_create_rejects_invalid_email_and_empty_name(harness):
    c = harness.admin_client()
    r = create(c, "Ana", "nu-e-email")
    assert r.status_code == 400
    assert "Email invalid" in r.text
    r = create(c, "  ", "ana@firma.ro")
    assert r.status_code == 400
    assert "Numele lipsește" in r.text
    assert "ana@firma.ro" not in c.get("/admin/employees").text


def test_create_rejects_duplicate_email(harness):
    c = harness.admin_client()
    create(c, "Ana", "ana@firma.ro")
    r = create(c, "Altă Ana", "ANA@firma.ro")
    assert r.status_code == 400
    assert "Email deja existent" in r.text
    assert "Altă Ana" not in c.get("/admin/employees").text


def test_csv_import_creates_valid_rows_and_reports_invalid_ones(harness):
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
    assert "2 Angajați importați" in r.text
    assert "Rândul 3: email invalid" in r.text
    assert "Rândul 4: numele lipsește" in r.text
    assert "Rândul 5: email deja existent" in r.text
    assert "Rândul 7: se așteaptă două coloane" in r.text
    page = c.get("/admin/employees").text
    assert "Ana Pop" in page and "Ion Vasile" in page
    assert "Bogdan" not in page and "Ana Duplicat" not in page


def test_csv_import_handles_300_rows(harness):
    c = harness.admin_client()
    rows = "\n".join(f"Angajat {i},angajat{i}@firma.ro" for i in range(300))
    r = import_csv(c, "nume,email\n" + rows + "\n")
    assert "300 Angajați importați" in r.text
    assert "Angajat 299" in c.get("/admin/employees").text


def test_csv_import_accepts_semicolons_bom_and_missing_trailing_newline(harness):
    c = harness.admin_client()
    r = import_csv(c, "﻿Nume;Email\nAna;ana@firma.ro\nIon;ion@firma.ro")
    assert "2 Angajați importați" in r.text


def test_csv_import_rejects_file_without_expected_header(harness):
    c = harness.admin_client()
    r = import_csv(c, "foo,bar\nAna,ana@firma.ro\n")
    assert r.status_code == 400
    assert "antet" in r.text
    assert "Ana" not in c.get("/admin/employees").text


def test_csv_import_requires_login(harness):
    r = import_csv(harness.client(), "nume,email\nAna,ana@firma.ro\n", follow_redirects=False)
    assert r.status_code == 303
    assert "Ana" not in harness.admin_client().get("/admin/employees").text


def test_admin_actions_appear_in_jurnal_with_author(harness):
    c = harness.admin_client()
    create(c, "Ana Pop", "ana@firma.ro")
    import_csv(c, "nume,email\nIon,ion@firma.ro\nRău,rau\n")
    page = c.get("/admin/jurnal").text
    assert "Angajat creat: Ana Pop" in page
    assert "Angajat importat din CSV: Ion" in page
    assert "Import CSV: 1 importați, 1 respinse" in page
    assert page.count("admin") >= 3  # autorul apare pe linii
    assert "2026-01-05T08:12:00+00:00" in page  # ceasul injectat, UTC


def test_failed_attempts_do_not_write_created_entries(harness):
    c = harness.admin_client()
    create(c, "Ana", "nu-e-email")
    assert "Angajat creat" not in c.get("/admin/jurnal").text


def test_jurnal_requires_login(harness):
    r = harness.client().get("/admin/jurnal", follow_redirects=False)
    assert r.status_code == 303


def test_layout_is_responsive_for_narrow_screens(harness):
    c = harness.admin_client()
    page = c.get("/admin/employees").text
    assert 'name="viewport"' in page
    css = c.get("/static/app.css").text
    assert "@media (max-width" in css
    assert "stackable" in page
