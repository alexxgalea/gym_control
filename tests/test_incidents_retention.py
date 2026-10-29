"""Incidente și retenție: Adminul marchează/închide Incidente; `tick` șterge datele vechi.

Ceas de start: 2026-01-05 08:12 UTC (10:12 local, iarna UTC+2). Perioada implicită: 12 luni.
"""

from datetime import datetime, timezone

PURGE = "Păstrarea datelor"
FAR = datetime(2027, 2, 5, 12, 0, tzinfo=timezone.utc)  # > 12 luni după ceasul de start


def _journal(harness) -> str:
    return harness.admin_client().get("/api/admin/journal").text


def _anomalies(harness) -> str:
    rows = harness.admin_client().get("/api/admin/anomalies").json()
    return "\n".join(f"{a['employee_name']} | {a['label']}" for a in rows) or "Nu există Anomalii"


def _enter(harness, name="Ana Pop"):
    phone = harness.enrolled_client(name)
    assert phone.post("/api/employee/entry", json={"totp": harness.current_totp()}).status_code == 200
    return phone


def _exit(harness, phone):
    assert phone.post("/api/employee/exit", json={"totp": harness.current_totp()}).status_code == 200


def _mark(admin, start="2026-01-05T10:00", end="2026-01-05T11:30", note="Aparat spart"):
    return admin.post("/api/admin/incidents", json={"start": start, "end": end, "note": note})


def _incident_id(admin) -> int:
    return admin.get("/api/admin/incidents").json()[0]["id"]


# --- API-ul Incidente ------------------------------------------------------------------

def test_incidents_api_requires_admin(harness):
    assert harness.client().get("/api/admin/incidents").status_code == 401
    assert harness.client().post("/api/admin/incidents", json={}).status_code in (401, 403)
    assert harness.client().post("/api/admin/incidents/1/close").status_code in (401, 403)


def test_admin_marks_incident_and_it_is_listed_open_in_local_time_and_journaled_with_author(harness):
    admin = harness.admin_client()
    r = _mark(admin)
    assert r.status_code == 201
    created = r.json()
    rows = admin.get("/api/admin/incidents").json()
    assert rows == [created]
    assert created["note"] == "Aparat spart"
    assert created["start"] == "2026-01-05 10:00" and created["end"] == "2026-01-05 11:30"
    assert created["status"] == "open" and created["created_by"] == "admin"
    assert created["closed_at"] is None and created["closed_by"] is None
    journal = _journal(harness)
    assert "Incident marcat" in journal and "admin" in journal


def test_incident_note_is_optional(harness):
    assert _mark(harness.admin_client(), note="").status_code == 201


def test_invalid_incident_interval_is_rejected_with_the_field_to_show_it_next_to(harness):
    admin = harness.admin_client()
    r = _mark(admin, start="2026-01-05T12:00", end="2026-01-05T10:00")
    assert r.status_code == 400
    assert r.json() == {"detail": "Începutul trebuie să fie înainte de sfârșit.", "field": "start"}
    r = _mark(admin, start="nu-e-data", end="2026-01-05T10:00")
    assert r.status_code == 400 and r.json()["field"] == "start" and "invalide" in r.json()["detail"]
    r = _mark(admin, start="2026-01-05T10:00", end="")
    assert r.status_code == 400 and r.json()["field"] == "end" and "Sfârșitul" in r.json()["detail"]
    r = _mark(admin, start="", end="2026-01-05T10:00")
    assert r.status_code == 400 and r.json()["field"] == "start"
    r = _mark(admin, note="x" * 501)
    assert r.status_code == 400 and r.json()["field"] == "note" and "prea lungă" in r.json()["detail"]
    assert admin.get("/api/admin/incidents").json() == []


def test_admin_closes_incident_and_it_is_journaled_with_author(harness):
    admin = harness.admin_client()
    _mark(admin)
    r = admin.post(f"/api/admin/incidents/{_incident_id(admin)}/close")
    assert r.status_code == 200
    [row] = admin.get("/api/admin/incidents").json()
    assert row["status"] == "closed" and row["closed_by"] == "admin" and row["closed_at"] == "2026-01-05 10:12"
    assert r.json() == row
    assert "Incident închis" in _journal(harness)


def test_closing_unknown_or_already_closed_incident_is_404(harness):
    admin = harness.admin_client()
    r = admin.post("/api/admin/incidents/999/close")
    assert r.status_code == 404 and r.json()["detail"] == "Incident inexistent sau deja închis"
    _mark(admin)
    incident_id = _incident_id(admin)
    assert admin.post(f"/api/admin/incidents/{incident_id}/close").status_code == 200
    assert admin.post(f"/api/admin/incidents/{incident_id}/close").status_code == 404


def test_open_incidents_are_listed_before_closed_ones_newest_first(harness):
    admin = harness.admin_client()
    _mark(admin, start="2026-01-01T10:00", end="2026-01-01T11:00", note="vechi")
    _mark(admin, start="2026-01-03T10:00", end="2026-01-03T11:00", note="închis")
    _mark(admin, start="2026-01-02T10:00", end="2026-01-02T11:00", note="deschis")
    closed = [r for r in admin.get("/api/admin/incidents").json() if r["note"] == "închis"][0]
    admin.post(f"/api/admin/incidents/{closed['id']}/close")
    assert [r["note"] for r in admin.get("/api/admin/incidents").json()] == ["deschis", "vechi", "închis"]


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
    assert _journal(harness).count("Păstrarea datelor: șterse") == 1
    harness.tick()
    harness.clock.advance(minutes=1)
    harness.tick()
    assert _journal(harness).count("Păstrarea datelor: șterse") == 1


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
    admin.post(f"/api/admin/incidents/{_incident_id(admin)}/close")
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
    assert "Păstrarea datelor" in journal and "12 → 18" in journal and "admin" in journal


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


def test_incidents_carry_the_hall_timezone_for_display(harness):
    admin = harness.admin_client()
    _mark(admin)
    assert admin.get("/api/admin/incidents").json()[0]["timezone"] == "Europe/Bucharest"
