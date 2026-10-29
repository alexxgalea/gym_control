"""tick: Sesiunile deschise la ora de închidere (22:00 local = 20:00 UTC iarna; ceas start 10:12 local)."""

from datetime import datetime, timezone

LABEL = "Sesiune deschisă la ora de închidere"


def totp(harness):
    return {"totp": harness.current_totp()}


def _page(harness) -> str:
    return harness.admin_client().get("/admin/anomalies").text


def _journal(harness) -> str:
    return harness.admin_client().get("/admin/jurnal").text


def _enter(harness, name="Ana Pop"):
    phone = harness.enrolled_client(name)
    assert phone.post("/me/entry", data=totp(harness)).status_code == 200
    return phone


def test_tick_before_closing_marks_nothing(harness):
    _enter(harness)
    harness.clock.set(datetime(2026, 1, 5, 19, 59, tzinfo=timezone.utc))
    harness.tick()
    assert "Nu există Anomalii" in _page(harness)


def test_tick_at_closing_flags_open_session_without_closing_it(harness):
    phone = _enter(harness)
    harness.clock.set(datetime(2026, 1, 5, 20, 0, tzinfo=timezone.utc))
    harness.tick()
    page = _page(harness)
    assert "Ana Pop" in page
    assert LABEL in page
    # încă deschisă: Ieșirea este posibilă, nu s-a inventat una
    assert phone.post("/me/exit", data=totp(harness)).status_code == 200


def test_repeated_tick_does_not_duplicate_anomaly_or_journal(harness):
    _enter(harness)
    harness.clock.set(datetime(2026, 1, 5, 20, 0, tzinfo=timezone.utc))
    harness.tick()
    journal_once = _journal(harness).count(LABEL)
    assert journal_once >= 1
    harness.clock.advance(minutes=1)
    harness.tick()
    harness.tick()
    assert _journal(harness).count(LABEL) == journal_once
    assert _page(harness).count(LABEL) == 1


def test_closed_session_is_not_flagged(harness):
    phone = _enter(harness)
    harness.clock.advance(hours=1)
    phone.post("/me/exit", data=totp(harness))
    harness.clock.set(datetime(2026, 1, 5, 20, 5, tzinfo=timezone.utc))
    harness.tick()
    assert "Nu există Anomalii" in _page(harness)


def test_old_session_flagged_missing_exit_is_also_flagged_at_closing(harness):
    phone = _enter(harness)
    harness.clock.advance(days=1)
    phone.post("/me/entry", data=totp(harness))  # prima Sesiune devine „Ieșire lipsă”
    harness.clock.set(datetime(2026, 1, 6, 20, 0, tzinfo=timezone.utc))
    harness.tick()
    assert _page(harness).count(LABEL) == 2


def test_normal_exit_resolves_open_at_closing(harness):
    phone = _enter(harness)
    harness.clock.set(datetime(2026, 1, 5, 20, 0, tzinfo=timezone.utc))
    harness.tick()
    assert LABEL in _page(harness)
    assert phone.post("/me/exit", data=totp(harness)).status_code == 200
    assert "Nu există Anomalii" in _page(harness)
