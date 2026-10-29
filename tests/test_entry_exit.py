"""Intrare/Ieșire de bază, pe API-ul JSON. Ceasul de test: 08:12 UTC = 10:12 ora locală (iarna, UTC+2)."""

from datetime import datetime
from zoneinfo import ZoneInfo

ME = "/api/employee/me"
ENTRY = "/api/employee/entry"
EXIT = "/api/employee/exit"


def totp(harness):
    return {"totp": harness.current_totp()}


def test_outside_state_shows_name_and_no_open_entry(harness):
    body = harness.enrolled_client("Ana Pop").get(ME).json()
    assert body["name"] == "Ana Pop"
    assert body["inside_since"] is None
    assert body["time_zone"] == "Europe/Bucharest"


def test_entry_confirms_type_and_local_time_then_state_shows_inside(harness):
    phone = harness.enrolled_client("Ana Pop")
    r = phone.post(ENTRY, json=totp(harness))
    assert r.status_code == 200
    assert r.json() == {"message": "Intrare înregistrată la 10:12", "at": "2026-01-05T08:12:00+00:00",
                        "time_zone": "Europe/Bucharest"}
    assert phone.get(ME).json()["inside_since"] == "2026-01-05T08:12:00+00:00"


def test_exit_closes_session_and_confirms(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post(ENTRY, json=totp(harness))
    harness.clock.advance(hours=1, minutes=5)
    r = phone.post(EXIT, json=totp(harness))
    assert r.status_code == 200
    assert r.json()["message"] == "Ieșire înregistrată la 11:17"
    assert phone.get(ME).json()["inside_since"] is None


def test_can_enter_again_after_exit(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post(ENTRY, json=totp(harness))
    phone.post(EXIT, json=totp(harness))
    assert phone.post(ENTRY, json=totp(harness)).status_code == 200


def test_double_entry_is_rejected_with_clear_message(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post(ENTRY, json=totp(harness))
    harness.clock.advance(minutes=10)
    r = phone.post(ENTRY, json=totp(harness))
    assert r.status_code == 409
    assert r.json()["reason"] == "already_inside"
    assert "Ești deja în Sală din 10:12" in r.json()["detail"]


def test_exit_without_session_is_rejected(harness):
    r = harness.enrolled_client("Ana Pop").post(EXIT, json=totp(harness))
    assert r.status_code == 409
    assert r.json()["reason"] == "no_open_entry"
    assert "Nu ai o Intrare deschisă" in r.json()["detail"]


def test_stale_exit_after_state_change_is_rejected(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post(ENTRY, json=totp(harness))
    phone.post(EXIT, json=totp(harness))
    r = phone.post(EXIT, json=totp(harness))
    assert r.status_code == 409
    assert r.json()["reason"] == "no_open_entry"


def test_wrong_or_missing_code_is_code_invalid(harness):
    phone = harness.enrolled_client("Ana Pop")
    for r in (phone.post(ENTRY, json={"totp": "00000000"}), phone.post(ENTRY)):
        assert r.status_code == 403
        assert r.json()["reason"] == "code_invalid"
    assert phone.get(ME).json()["inside_since"] is None


def test_expired_code_is_code_invalid(harness):
    phone = harness.enrolled_client("Ana Pop")
    code = harness.current_totp()
    harness.clock.advance(minutes=3)
    r = phone.post(ENTRY, json={"totp": code})
    assert r.status_code == 403
    assert r.json()["reason"] == "code_invalid"
    assert "expirat" in r.json()["detail"]


def test_events_are_in_journal_with_their_utc_moment(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/api/employee/entry", json=totp(harness))
    harness.clock.advance(hours=2)
    phone.post("/api/employee/exit", json=totp(harness))
    body = harness.admin_client().get("/api/admin/journal").json()
    local = {
        e["summary"]: datetime.fromisoformat(e["at"]).astimezone(ZoneInfo(body["timezone"]))
        for e in body["entries"]
    }
    # `at` e UTC, `timezone` e fusul Sălii: SPA-ul afișează ora locală din cele două
    assert local["Intrare: Ana Pop"].strftime("%Y-%m-%d %H:%M") == "2026-01-05 10:12"
    assert local["Ieșire: Ana Pop"].strftime("%Y-%m-%d %H:%M") == "2026-01-05 12:12"
    entry = next(e for e in body["entries"] if e["summary"] == "Intrare: Ana Pop")
    assert entry["at"] == "2026-01-05T08:12:00+00:00"


def test_rejected_events_are_not_journaled(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post(EXIT, json=totp(harness))
    assert "Ieșire: Ana Pop" not in harness.admin_client().get("/api/admin/journal").text


def test_states_are_per_employee(harness):
    ana = harness.enrolled_client("Ana Pop")
    ion = harness.enrolled_client("Ion Vasile")
    ana.post("/api/employee/entry", json=totp(harness))
    assert ion.get(ME).json()["inside_since"] is None
    assert ion.post("/api/employee/entry", json=totp(harness)).status_code == 200


def test_event_routes_require_enrolled_device(harness):
    c = harness.client()
    assert c.post(ENTRY, json=totp(harness)).status_code == 401
    assert c.post(EXIT, json=totp(harness)).status_code == 401


def test_display_timezone_is_a_setting(make_harness):
    h = make_harness(timezone="UTC")
    phone = h.enrolled_client("Ana Pop")
    assert phone.post(ENTRY, json=totp(h)).json()["message"] == "Intrare înregistrată la 08:12"
