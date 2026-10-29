"""Anomalii la eveniment. Ceasul de test: 08:12 UTC = 10:12 local (program implicit 06:00-22:00)."""

from datetime import datetime, timezone


def totp(harness):
    return {"totp": harness.current_totp()}


class _Rows(list):
    """Anomaliile din API-ul JSON; `in` și `count` caută după eticheta afișată (română), ca pe ecran."""

    def __contains__(self, text):
        return self.count(text) > 0

    def count(self, text):
        return sum(1 for a in self if text in a["label"])


def _anomalies(harness) -> _Rows:
    r = harness.admin_client().get("/api/admin/anomalies")
    assert r.status_code == 200
    return _Rows(r.json())


def test_anomalies_api_requires_admin_and_is_empty_without_anomalies(harness):
    c = harness.client()
    assert c.get("/api/admin/anomalies").status_code == 401
    assert c.post("/api/admin/anomalies/1/dismiss").status_code == 401
    assert harness.admin_client().get("/api/admin/anomalies").json() == []


def test_entry_over_old_open_session_is_accepted_and_old_session_flagged(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    harness.clock.advance(days=1)
    r = phone.post("/me/entry", data=totp(harness))
    assert r.status_code == 200
    assert "Intrare înregistrată la 10:12" in r.text
    rows = _anomalies(harness)
    assert [(a["employee_name"], a["code"], a["label"]) for a in rows] == [
        ("Ana Pop", "missing_exit", "Ieșire lipsă")]
    assert rows[0]["exit_at"] is None and rows[0]["session_id"] > 0


def test_old_session_is_not_closed_and_exit_closes_the_new_one(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    harness.clock.advance(days=1)
    phone.post("/me/entry", data=totp(harness))
    harness.clock.advance(hours=1)
    assert phone.post("/me/exit", data=totp(harness)).status_code == 200
    assert "în afara Sălii" in phone.get("/me").text
    assert phone.post("/me/exit", data=totp(harness)).status_code == 409
    assert "Ieșire lipsă" in _anomalies(harness)


def test_flagging_is_not_duplicated_across_repeated_entries(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    harness.clock.advance(days=1)
    phone.post("/me/entry", data=totp(harness))
    phone.post("/me/exit", data=totp(harness))
    phone.post("/me/entry", data=totp(harness))
    assert _anomalies(harness).count("Ieșire lipsă") == 1


def test_recent_open_session_still_rejects_entry(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    harness.clock.advance(hours=2)
    assert phone.post("/me/entry", data=totp(harness)).status_code == 409
    assert _anomalies(harness) == []


def test_entry_outside_hours_is_accepted_and_flagged(harness):
    phone = harness.enrolled_client("Ana Pop")
    harness.clock.set(datetime(2026, 1, 5, 21, 30, tzinfo=timezone.utc))  # 23:30 local
    r = phone.post("/me/entry", data=totp(harness))
    assert r.status_code == 200
    assert "Intrare înregistrată la 23:30" in r.text
    [row] = _anomalies(harness)
    assert row["employee_name"] == "Ana Pop"
    assert (row["code"], row["label"]) == ("outside_hours", "Intrare în afara programului")
    assert row["at"] == row["entry_at"] == "2026-01-05 23:30"  # ora locală


def test_entry_before_opening_is_flagged_and_within_hours_is_not(harness):
    phone = harness.enrolled_client("Ana Pop")
    harness.clock.set(datetime(2026, 1, 5, 3, 0, tzinfo=timezone.utc))  # 05:00 local
    phone.post("/me/entry", data=totp(harness))
    phone.post("/me/exit", data=totp(harness))
    harness.clock.set(datetime(2026, 1, 5, 8, 0, tzinfo=timezone.utc))  # 10:00 local
    phone.post("/me/entry", data=totp(harness))
    assert _anomalies(harness).count("în afara programului") == 1


def test_outside_hours_follows_runtime_settings(harness):
    admin = harness.admin_client()
    r = admin.put("/api/admin/settings", json={
        "hall_subnet": "192.168.10.0/24", "opening_time": "12:00", "closing_time": "20:00"})
    assert r.status_code == 200
    harness.enrolled_client("Ana Pop").post("/me/entry", data=totp(harness))  # 10:12 local, în afara programului
    assert "în afara programului" in _anomalies(harness)


def test_exit_on_old_open_session_is_rejected_and_flags_missing_exit(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    harness.clock.advance(days=1)
    r = phone.post("/me/exit", data=totp(harness))
    assert r.status_code == 409
    assert "Nu ai o Intrare deschisă azi" in r.text
    assert "Adminul poate corecta" in r.text
    assert "Ieșire lipsă" in _anomalies(harness)
    # nu s-a inventat nicio oră de Ieșire: o a doua încercare e tot respinsă, iar Intrarea nouă merge
    assert phone.post("/me/exit", data=totp(harness)).status_code == 409
    assert phone.post("/me/entry", data=totp(harness)).status_code == 200
    assert _anomalies(harness).count("Ieșire lipsă") == 1


def _outside_hours_session(harness):
    phone = harness.enrolled_client("Ana Pop")
    harness.clock.set(datetime(2026, 1, 5, 21, 30, tzinfo=timezone.utc))  # 23:30 local
    assert phone.post("/me/entry", data=totp(harness)).status_code == 200
    return phone


def test_outside_hours_can_be_dismissed_by_admin_and_is_journaled(harness):
    _outside_hours_session(harness)
    admin = harness.admin_client()
    [row] = admin.get("/api/admin/anomalies").json()
    r = admin.post(f"/api/admin/anomalies/{row['id']}/dismiss")
    assert r.status_code == 204
    assert admin.get("/api/admin/anomalies").json() == []
    jurnal = admin.get("/api/admin/journal").text
    assert "Anomalie verificată" in jurnal and "Ana Pop" in jurnal and "admin" in jurnal
    # rămâne vizibilă în Raport
    rep = admin.get("/api/admin/reports?from=2026-01-05T23:00&to=2026-01-06T00:00").text
    assert "Intrare în afara programului" in rep


def test_dismissing_twice_or_unknown_is_404_with_message(harness):
    _outside_hours_session(harness)
    admin = harness.admin_client()
    [row] = admin.get("/api/admin/anomalies").json()
    admin.post(f"/api/admin/anomalies/{row['id']}/dismiss")
    r = admin.post(f"/api/admin/anomalies/{row['id']}/dismiss")
    assert r.status_code == 404
    assert r.json() == {"detail": "Anomalie inexistentă sau deja rezolvată"}
    assert admin.post("/api/admin/anomalies/999/dismiss").status_code == 404


def test_only_outside_hours_anomalies_can_be_dismissed(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    harness.clock.advance(days=1)
    phone.post("/me/entry", data=totp(harness))
    admin = harness.admin_client()
    [row] = admin.get("/api/admin/anomalies").json()
    assert row["code"] == "missing_exit"
    assert admin.post(f"/api/admin/anomalies/{row['id']}/dismiss").status_code == 404
    assert len(admin.get("/api/admin/anomalies").json()) == 1


def test_open_at_closing_is_listed_and_cannot_be_dismissed(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    harness.clock.set(datetime(2026, 1, 5, 20, 12, tzinfo=timezone.utc))  # 22:12 local
    harness.tick()
    admin = harness.admin_client()
    [row] = admin.get("/api/admin/anomalies").json()
    assert row["label"] == "Sesiune deschisă la ora de închidere" and row["exit_at"] is None
    assert admin.post(f"/api/admin/anomalies/{row['id']}/dismiss").status_code == 404  # nu se închide cu "verificată"
