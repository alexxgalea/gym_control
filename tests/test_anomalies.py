"""Anomalii la eveniment. Ceasul de test: 08:12 UTC = 10:12 local (program implicit 06:00-22:00)."""

import re
from datetime import datetime, timezone


def totp(harness):
    return {"totp": harness.current_totp()}


def _anomalies(harness) -> str:
    r = harness.admin_client().get("/admin/anomalies")
    assert r.status_code == 200
    return r.text


def test_anomalies_screen_requires_admin_and_is_in_nav(harness):
    r = harness.client().get("/admin/anomalies", follow_redirects=False)
    assert r.status_code in (303, 401)
    page = _anomalies(harness)
    assert 'href="/admin/anomalies"' in page
    assert "stackable" in page
    assert "Nu există Anomalii" in page


def test_entry_over_old_open_session_is_accepted_and_old_session_flagged(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    harness.clock.advance(days=1)
    r = phone.post("/me/entry", data=totp(harness))
    assert r.status_code == 200
    assert "Intrare înregistrată la 10:12" in r.text
    page = _anomalies(harness)
    assert "Ana Pop" in page
    assert "Ieșire lipsă" in page


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
    assert "Nu există Anomalii" in _anomalies(harness)


def test_entry_outside_hours_is_accepted_and_flagged(harness):
    phone = harness.enrolled_client("Ana Pop")
    harness.clock.set(datetime(2026, 1, 5, 21, 30, tzinfo=timezone.utc))  # 23:30 local
    r = phone.post("/me/entry", data=totp(harness))
    assert r.status_code == 200
    assert "Intrare înregistrată la 23:30" in r.text
    page = _anomalies(harness)
    assert "Ana Pop" in page
    assert "în afara programului" in page
    assert "2026-01-05 23:30" in page


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
    r = admin.post("/admin/settings", data={
        "hall_subnet": "192.168.10.0/24", "opening_time": "12:00", "closing_time": "20:00"},
        follow_redirects=False)
    assert r.status_code == 303
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
    page = admin.get("/admin/anomalies").text
    m = re.search(r"/admin/anomalies/(\d+)/dismiss", page)
    assert m, page
    r = admin.post(m.group(0), follow_redirects=False)
    assert r.status_code == 303
    assert "Nu există Anomalii" in admin.get("/admin/anomalies").text
    assert "Anomalie verificată" in admin.get("/admin/jurnal").text
    # rămâne vizibilă în Raport
    rep = admin.get("/api/admin/reports?from=2026-01-05T23:00&to=2026-01-06T00:00").text
    assert "Intrare în afara programului" in rep


def test_only_outside_hours_anomalies_can_be_dismissed(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    harness.clock.advance(days=1)
    phone.post("/me/entry", data=totp(harness))
    admin = harness.admin_client()
    page = admin.get("/admin/anomalies").text
    assert "/dismiss" not in page
    assert admin.post("/admin/anomalies/1/dismiss").status_code == 404
