"""Raportul de prezență. Ceasul de test: 08:12 UTC = 10:12 local (iarna, UTC+2)."""

import csv
import io
from datetime import datetime, time, timezone

from gym_control import db as db_module
from gym_control import reports

# interval local 2026-01-05 10:00 - 12:00
Q = "from=2026-01-05T10:00&to=2026-01-05T12:00"


def totp(h):
    return {"totp": h.current_totp()}


def _report(h, q=Q, path="/admin/reports"):
    return h.admin_client().get(f"{path}?{q}")


def _at(h, hour, minute=0):
    h.clock.set(datetime(2026, 1, 5, hour, minute, tzinfo=timezone.utc))


def test_requires_admin_in_nav_and_form(harness):
    for p in ("/admin/reports", "/admin/reports.csv", "/admin/reports/print"):
        assert harness.client().get(f"{p}?{Q}", follow_redirects=False).status_code in (303, 401)
    page = harness.admin_client().get("/admin/reports").text
    assert 'href="/admin/reports"' in page
    assert 'type="datetime-local"' in page


def test_report_lists_overlapping_sessions_including_straddling_ones(harness):
    ana = harness.enrolled_client("Ana Pop")
    bob = harness.enrolled_client("Bob Ionescu")
    cris = harness.enrolled_client("Cris Dan")
    dan = harness.enrolled_client("Dan Vlad")
    eva = harness.enrolled_client("Eva Stan")
    # Ana 09:00-10:30 local (începe înainte)
    _at(harness, 7); ana.post("/me/entry", data=totp(harness))
    _at(harness, 8, 30); ana.post("/me/exit", data=totp(harness))
    # Bob 11:30-13:00 local (se termină după)
    _at(harness, 9, 30); bob.post("/me/entry", data=totp(harness))
    _at(harness, 11); bob.post("/me/exit", data=totp(harness))
    # Cris 08:00-09:50 (înainte)
    _at(harness, 6); cris.post("/me/entry", data=totp(harness))
    _at(harness, 7, 50); cris.post("/me/exit", data=totp(harness))
    # Dan 13:00-14:00 (după)
    _at(harness, 11); dan.post("/me/entry", data=totp(harness))
    _at(harness, 12); dan.post("/me/exit", data=totp(harness))
    # Eva 10:30-10:45 (înăuntru)
    _at(harness, 8, 30); eva.post("/me/entry", data=totp(harness))
    _at(harness, 8, 45); eva.post("/me/exit", data=totp(harness))
    page = _report(harness).text
    assert "Ana Pop" in page and "Bob Ionescu" in page and "Eva Stan" in page
    assert "Cris Dan" not in page and "Dan Vlad" not in page
    assert "2026-01-05 09:00" in page and "2026-01-05 10:30" in page
    assert "Cod QR" in page
    for col in ("Angajat", "Intrare", "Ieșire", "Metoda de validare"):
        assert col in page
    assert "stackable" in page


def test_open_session_is_marked_and_present_until_closing(harness):
    ana = harness.enrolled_client("Ana Pop")
    ana.post("/me/entry", data=totp(harness))  # 10:12 local, deschisă
    page = _report(harness, "from=2026-01-05T15:00&to=2026-01-05T16:00").text
    assert "Ana Pop" in page and "deschisă" in page
    late = _report(harness, "from=2026-01-05T22:30&to=2026-01-05T23:00").text
    assert "Ana Pop" not in late
    early = _report(harness, "from=2026-01-05T08:00&to=2026-01-05T09:00").text
    assert "Ana Pop" not in early


def test_anomaly_labels_are_shown(harness):
    ana = harness.enrolled_client("Ana Pop")
    _at(harness, 21, 30)  # 23:30 local
    ana.post("/me/entry", data=totp(harness))
    page = _report(harness, "from=2026-01-05T23:00&to=2026-01-06T00:00").text
    assert "Ana Pop" in page and "Intrare în afara programului" in page


def test_invalid_intervals_show_romanian_errors(harness):
    r = _report(harness, "from=2026-01-05T12:00&to=2026-01-05T10:00")
    assert r.status_code == 400 and "înainte" in r.text
    assert _report(harness, "from=2026-01-05T10:00&to=2026-01-05T10:00").status_code == 400
    r = _report(harness, "from=nu-e-data&to=2026-01-05T10:00")
    assert r.status_code == 400 and "invalid" in r.text
    assert _report(harness, "from=2026-01-05T10:00&to=").status_code == 400
    assert harness.admin_client().get("/admin/reports.csv?from=x&to=y").status_code == 400


def test_generating_report_is_journaled_with_author_and_interval(harness):
    harness.enrolled_client("Ana Pop").post("/me/entry", data=totp(harness))
    admin = harness.admin_client()
    admin.get("/admin/reports")  # fără interval: nu e Raport
    assert "Raport de prezență" not in admin.get("/api/admin/journal").text
    assert admin.get(f"/admin/reports?{Q}").status_code == 200
    journal = admin.get("/api/admin/journal").text
    assert "Raport de prezență generat" in journal
    assert "2026-01-05 10:00" in journal and "2026-01-05 12:00" in journal
    assert "admin" in journal
    admin.get(f"/admin/reports.csv?{Q}")
    assert "Raport de prezență exportat" in admin.get("/api/admin/journal").text


def test_csv_export_utf8_bom_columns_and_formula_safety(harness):
    harness.enrolled_client('=HYPERLINK("x")', "evil@firma.ro").post("/me/entry", data=totp(harness))
    r = _report(harness, path="/admin/reports.csv")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    assert r.content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows[0] == ["Angajat", "Intrare", "Ieșire", "Eticheta", "Metoda de validare"]
    assert rows[1][0].startswith("'=")
    assert rows[1][2] == "deschisă"


def test_print_version_has_disclaimer(harness):
    harness.enrolled_client("Ana Pop").post("/me/entry", data=totp(harness))
    page = _report(harness, path="/admin/reports/print").text
    assert "Ana Pop" in page
    assert "listă credibilă de persoane" in page and "nu o dovadă a vinovăției" in page
    assert "2026-01-05 10:00" in page
    assert "/admin/reports/print?" in _report(harness).text


def test_manual_sessions_are_labeled_manual():
    conn = db_module.connect(":memory:")
    conn.execute("INSERT INTO employees (id, name, email, created_at) VALUES (1,'Ana','a@f.ro','x')")
    conn.execute(
        "INSERT INTO sessions (employee_id, entry_at, exit_at, entry_method, exit_method,"
        " is_manual, manual_reason) VALUES (1,'2026-01-05T08:00:00+00:00','2026-01-05T09:00:00+00:00',"
        "'manual','manual',1,'Telefon defect')")
    x = datetime(2026, 1, 5, 7, 0, tzinfo=timezone.utc)
    y = datetime(2026, 1, 5, 10, 0, tzinfo=timezone.utc)
    [row] = reports.query(conn, "Europe/Bucharest", time(22, 0), x, y)
    assert row.manual and "manuală" in row.method_label
    assert "Sesiune manuală" in row.label and "Telefon defect" in row.label
