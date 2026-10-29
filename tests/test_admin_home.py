"""Acum în Sală (`GET /api/admin/in-hall`). Ceasul de test: 08:12 UTC = 10:12 local."""


def _enter(harness, name):
    phone = harness.enrolled_client(name)
    assert phone.post("/api/employee/entry", json={"totp": harness.current_totp()}).status_code == 200
    return phone


def test_in_hall_requires_admin(harness):
    assert harness.client().get("/api/admin/in-hall").status_code == 401


def test_in_hall_is_empty_without_open_sessions(harness):
    r = harness.admin_client().get("/api/admin/in-hall")
    assert r.status_code == 200
    assert r.json() == {"timezone": "Europe/Bucharest", "people": [], "door_screen_active": False}


def test_in_hall_reports_door_screen_active_once_activated(harness):
    admin = harness.admin_client()
    assert admin.get("/api/admin/in-hall").json()["door_screen_active"] is False
    harness.door_client()
    assert admin.get("/api/admin/in-hall").json()["door_screen_active"] is True


def test_in_hall_lists_open_sessions_of_today_with_entry_and_minutes(harness):
    _enter(harness, "Ana Pop")
    harness.clock.advance(minutes=35)
    people = harness.admin_client().get("/api/admin/in-hall").json()["people"]
    assert [(p["employee_name"], p["entry_at"], p["minutes"]) for p in people] == [
        ("Ana Pop", "2026-01-05 10:12", 35)]


def test_in_hall_excludes_closed_sessions(harness):
    phone = _enter(harness, "Ana Pop")
    _enter(harness, "Dan Ene")
    harness.clock.advance(minutes=10)
    assert phone.post("/api/employee/exit", json={"totp": harness.current_totp()}).status_code == 200
    people = harness.admin_client().get("/api/admin/in-hall").json()["people"]
    assert [p["employee_name"] for p in people] == ["Dan Ene"]


def test_in_hall_excludes_session_left_open_from_a_previous_day(harness):
    _enter(harness, "Ana Pop")
    harness.clock.advance(days=1)
    assert harness.admin_client().get("/api/admin/in-hall").json()["people"] == []
    _enter(harness, "Dan Ene")
    people = harness.admin_client().get("/api/admin/in-hall").json()["people"]
    assert [p["employee_name"] for p in people] == ["Dan Ene"]


def test_in_hall_day_boundary_is_hall_midnight_not_utc(harness):
    _enter(harness, "Ana Pop")  # 10:12 local, 5 ian.
    harness.clock.advance(hours=13, minutes=40)  # 23:52 local: tot azi
    assert len(harness.admin_client().get("/api/admin/in-hall").json()["people"]) == 1
    harness.clock.advance(minutes=30)  # 00:22 local, 6 ian. (încă 5 ian. în UTC)
    assert harness.admin_client().get("/api/admin/in-hall").json()["people"] == []
