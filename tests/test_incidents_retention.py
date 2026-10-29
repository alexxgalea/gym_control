"""Incidente și retenție: Adminul marchează/închide Incidente; `tick` șterge datele vechi.

Ceas de start: 2026-01-05 08:12 UTC (10:12 local, iarna UTC+2). Perioada implicită: 12 luni.
"""

import re
from datetime import datetime, timezone

PURGE = "Retenție"
FAR = datetime(2027, 2, 5, 12, 0, tzinfo=timezone.utc)  # > 12 luni după ceasul de start


def _journal(harness) -> str:
    return harness.admin_client().get("/admin/jurnal").text


def _anomalies(harness) -> str:
    return harness.admin_client().get("/admin/anomalies").text


def _enter(harness, name="Ana Pop"):
    phone = harness.enrolled_client(name)
    assert phone.post("/me/entry", data={"totp": harness.current_totp()}).status_code == 200
    return phone


def _exit(harness, phone):
    assert phone.post("/me/exit", data={"totp": harness.current_totp()}).status_code == 200


def _mark(admin, start="2026-01-05T10:00", end="2026-01-05T11:30", note="Aparat spart"):
    return admin.post("/admin/incidents", data={"start": start, "end": end, "note": note},
                      follow_redirects=False)


def _incident_id(admin) -> str:
    return re.search(r'data-incident-id="(\d+)"', admin.get("/admin/incidents").text).group(1)


# --- ecranul Incidente -----------------------------------------------------------------

def test_incidents_screen_requires_admin(harness):
    r = harness.client().get("/admin/incidents", follow_redirects=False)
    assert r.status_code in (303, 401)


def test_admin_marks_incident_and_it_is_listed_open_and_journaled_with_author(harness):
    admin = harness.admin_client()
    assert _mark(admin).status_code == 303
    page = admin.get("/admin/incidents").text
    assert "Aparat spart" in page
    assert "2026-01-05 10:00" in page and "2026-01-05 11:30" in page
    assert "Deschis" in page
    assert 'href="/admin/incidents"' in page
    journal = _journal(harness)
    assert "Incident marcat" in journal and "admin" in journal


def test_incident_note_is_optional(harness):
    assert _mark(harness.admin_client(), note="").status_code == 303


def test_invalid_incident_interval_is_rejected(harness):
    admin = harness.admin_client()
    assert _mark(admin, start="2026-01-05T12:00", end="2026-01-05T10:00").status_code == 400
    assert _mark(admin, start="nu-e-data", end="2026-01-05T10:00").status_code == 400
    assert "Nu există Incidente" in admin.get("/admin/incidents").text


def test_admin_closes_incident_and_it_is_journaled_with_author(harness):
    admin = harness.admin_client()
    _mark(admin)
    r = admin.post(f"/admin/incidents/{_incident_id(admin)}/close", follow_redirects=False)
    assert r.status_code == 303
    page = admin.get("/admin/incidents").text
    assert "Închis" in page and "Deschis" not in page
    assert "Incident închis" in _journal(harness)


def test_incidents_screen_is_mobile_friendly(harness):
    admin = harness.admin_client()
    _mark(admin)
    page = admin.get("/admin/incidents").text
    assert 'name="viewport"' in page and "stackable" in page and 'data-label="Interval"' in page


# --- retenția --------------------------------------------------------------------------

def test_tick_deletes_data_older_than_retention(harness):
    harness.clock.set(datetime(2026, 1, 5, 3, 0, tzinfo=timezone.utc))  # 05:00 local: în afara programului
    phone = _enter(harness)
    _exit(harness, phone)
    assert "Intrare: Ana Pop" in _journal(harness)
    assert "Intrare în afara programului" in _anomalies(harness)
    harness.clock.set(FAR)
    harness.tick()
    journal = _journal(harness)
    assert "Intrare: Ana Pop" not in journal and "Ieșire: Ana Pop" not in journal
    assert PURGE in journal
    assert "Nu există Anomalii" in _anomalies(harness)


def test_recent_data_is_kept_and_nothing_is_journaled_when_nothing_deleted(harness):
    _enter(harness)
    harness.clock.set(datetime(2026, 12, 20, 12, 0, tzinfo=timezone.utc))  # ~11 luni
    harness.tick()
    journal = _journal(harness)
    assert "Intrare: Ana Pop" in journal and PURGE not in journal


def test_retention_is_idempotent(harness):
    _enter(harness)
    harness.clock.set(FAR)
    harness.tick()
    assert _journal(harness).count("Retenție: șterse") == 1
    harness.tick()
    harness.clock.advance(minutes=1)
    harness.tick()
    assert _journal(harness).count("Retenție: șterse") == 1


def test_accounts_survive_retention(harness):
    _enter(harness)
    harness.clock.set(FAR)
    harness.tick()
    assert [e["name"] for e in harness.admin_client().get("/api/admin/employees").json()] == ["Ana Pop"]


def test_session_straddling_the_cutoff_is_kept_with_its_journal_rows(harness):
    harness.clock.set(datetime(2026, 1, 15, 11, 0, tzinfo=timezone.utc))
    phone = _enter(harness)  # înainte de tăietură, în aceeași zi locală cu Ieșirea
    harness.clock.set(datetime(2026, 1, 15, 13, 0, tzinfo=timezone.utc))
    _exit(harness, phone)
    harness.clock.set(datetime(2027, 1, 15, 12, 0, tzinfo=timezone.utc))  # tăietura: 15 ian 2026
    harness.tick()
    journal = _journal(harness)
    assert "Ieșire: Ana Pop" in journal and "Intrare: Ana Pop" in journal


# --- excepția Incident -----------------------------------------------------------------

def _two_employees(harness):
    _enter(harness, "Ana Pop")                                     # 08:12 UTC = 10:12 local
    harness.clock.set(datetime(2026, 1, 5, 12, 0, tzinfo=timezone.utc))
    _enter(harness, "Dan Ionescu")                                 # 14:00 local: în afara Incidentului


def test_data_inside_open_incident_is_not_deleted(harness):
    _two_employees(harness)
    _mark(harness.admin_client(), start="2026-01-05T10:00", end="2026-01-05T11:30")
    harness.clock.set(FAR)
    harness.tick()
    journal = _journal(harness)
    assert "Intrare: Ana Pop" in journal
    assert "Intrare: Dan Ionescu" not in journal


def test_closed_incident_data_reenters_normal_retention(harness):
    _two_employees(harness)
    admin = harness.admin_client()
    _mark(admin, start="2026-01-05T10:00", end="2026-01-05T11:30")
    harness.clock.set(FAR)
    harness.tick()
    assert "Intrare: Ana Pop" in _journal(harness)
    admin = harness.admin_client()  # sesiunea Adminului a expirat între timp
    admin.post(f"/admin/incidents/{_incident_id(admin)}/close")
    harness.tick()
    assert "Intrare: Ana Pop" not in _journal(harness)


def test_session_overlapping_open_incident_is_kept(harness):
    phone = _enter(harness)                                         # 08:12 UTC
    harness.clock.set(datetime(2026, 1, 5, 9, 0, tzinfo=timezone.utc))
    _exit(harness, phone)
    _mark(harness.admin_client(), start="2026-01-05T10:50", end="2026-01-05T12:00")  # 08:50-10:00 UTC
    harness.clock.set(FAR)
    harness.tick()
    assert "Ieșire: Ana Pop" in _journal(harness)


# --- perioada configurabilă ------------------------------------------------------------

def _save(admin, months):
    return admin.put("/api/admin/settings", json={
        "hall_subnet": "192.168.10.0/24", "opening_time": "06:00", "closing_time": "22:00",
        "retention_months": months})


def test_settings_show_default_retention(harness):
    assert harness.admin_client().get("/api/admin/settings").json()["retention_months"] == 12


def test_longer_retention_keeps_data_and_shorter_deletes(harness):
    _enter(harness)
    admin = harness.admin_client()
    assert _save(admin, "24").status_code == 200
    harness.clock.set(FAR)  # ~13 luni
    harness.tick()
    assert "Intrare: Ana Pop" in _journal(harness)
    assert _save(harness.admin_client(), "6").status_code == 200
    harness.tick()
    assert "Intrare: Ana Pop" not in _journal(harness)


def test_retention_change_is_journaled_with_author(harness):
    _save(harness.admin_client(), "18")
    journal = _journal(harness)
    assert "Perioada de retenție" in journal and "12 → 18" in journal and "admin" in journal


def test_invalid_retention_is_rejected(harness):
    admin = harness.admin_client()
    for bad in ("0", "-3", "abc", "1.5"):
        assert _save(admin, bad).status_code == 400, bad
    assert admin.get("/api/admin/settings").json()["retention_months"] == 12


def test_retention_from_environment_configuration(make_harness):
    h = make_harness(retention_months=3)
    _enter(h)
    h.clock.set(datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc))
    h.tick()
    assert "Intrare: Ana Pop" not in _journal(h)
