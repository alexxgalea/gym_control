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


def _report(h, q=Q, path="/api/admin/reports"):
    return h.admin_client().get(f"{path}?{q}")


def _names(response):
    return [r["employee_name"] for r in response.json()["rows"]]


def _at(h, hour, minute=0):
    h.clock.set(datetime(2026, 1, 5, hour, minute, tzinfo=timezone.utc))


def test_requires_admin(harness):
    for p in ("/api/admin/reports", "/api/admin/reports.csv"):
        assert harness.client().get(f"{p}?{Q}").status_code == 401


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
    body = _report(harness).json()
    assert [r["employee_name"] for r in body["rows"]] == ["Ana Pop", "Eva Stan", "Bob Ionescu"]
    ana_row = body["rows"][0]
    assert ana_row["entry"] == "2026-01-05 09:00" and ana_row["exit"] == "2026-01-05 10:30"
    assert ana_row["method_label"] == "Cod QR" and not ana_row["open"]
    assert body["date_from"] == "2026-01-05 10:00" and body["date_to"] == "2026-01-05 12:00"
    assert body["generated_by"] == "admin"
    assert "listă credibilă de persoane" in body["disclaimer"]
    assert "ora de închidere" in body["scope_text"]
    assert body["open_text"] == "deschisă"


def test_open_session_is_marked_and_present_until_closing(harness):
    ana = harness.enrolled_client("Ana Pop")
    ana.post("/me/entry", data=totp(harness))  # 10:12 local, deschisă
    [row] = _report(harness, "from=2026-01-05T15:00&to=2026-01-05T16:00").json()["rows"]
    assert row["employee_name"] == "Ana Pop" and row["open"] and row["exit"] is None
    assert _names(_report(harness, "from=2026-01-05T22:30&to=2026-01-05T23:00")) == []
    assert _names(_report(harness, "from=2026-01-05T08:00&to=2026-01-05T09:00")) == []


def test_anomaly_labels_are_shown(harness):
    ana = harness.enrolled_client("Ana Pop")
    _at(harness, 21, 30)  # 23:30 local
    ana.post("/me/entry", data=totp(harness))
    [row] = _report(harness, "from=2026-01-05T23:00&to=2026-01-06T00:00").json()["rows"]
    assert row["employee_name"] == "Ana Pop" and "Intrare în afara programului" in row["label"]


def test_invalid_intervals_return_romanian_errors(harness):
    r = _report(harness, "from=2026-01-05T12:00&to=2026-01-05T10:00")
    assert r.status_code == 400 and "înainte" in r.json()["detail"]
    assert _report(harness, "from=2026-01-05T10:00&to=2026-01-05T10:00").status_code == 400
    r = _report(harness, "from=nu-e-data&to=2026-01-05T10:00")
    assert r.status_code == 400 and "invalid" in r.json()["detail"]
    assert _report(harness, "from=2026-01-05T10:00&to=").status_code == 400
    r = harness.admin_client().get("/api/admin/reports.csv?from=x&to=y")
    assert r.status_code == 400 and r.json()["detail"]


def test_invalid_interval_is_not_journaled(harness):
    admin = harness.admin_client()
    admin.get("/api/admin/reports?from=2026-01-05T12:00&to=2026-01-05T10:00")
    assert "Raport de prezență" not in admin.get("/api/admin/journal").text


def test_generating_report_is_journaled_with_author_and_interval(harness):
    harness.enrolled_client("Ana Pop").post("/me/entry", data=totp(harness))
    admin = harness.admin_client()
    assert "Raport de prezență" not in admin.get("/api/admin/journal").text
    assert admin.get(f"/api/admin/reports?{Q}").status_code == 200
    journal = admin.get("/api/admin/journal").text
    assert "Raport de prezență generat" in journal
    assert "2026-01-05 10:00" in journal and "2026-01-05 12:00" in journal
    assert "admin" in journal
    assert admin.get(f"/api/admin/reports.csv?{Q}").status_code == 200
    assert "Raport de prezență exportat" in admin.get("/api/admin/journal").text


def test_csv_export_utf8_bom_columns_and_formula_safety(harness):
    harness.enrolled_client('=HYPERLINK("x")', "evil@firma.ro").post("/me/entry", data=totp(harness))
    r = _report(harness, path="/api/admin/reports.csv")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    assert r.content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows[0] == ["Angajat", "Intrare", "Ieșire", "Eticheta", "Metoda de validare"]
    assert rows[1][0].startswith("'=")
    assert rows[1][2] == "deschisă"


def test_csv_filename_names_the_interval(harness):
    r = _report(harness, path="/api/admin/reports.csv")
    assert 'filename="raport-prezenta_20260105-1000_20260105-1200.csv"' in r.headers["content-disposition"]


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
