"""Intrare/Ieșire de bază. Ceasul de test: 08:12 UTC = 10:12 ora locală (iarna, UTC+2)."""

from datetime import datetime
from zoneinfo import ZoneInfo


def totp(harness):
    return {"totp": harness.current_totp()}


def test_outside_state_shows_name_and_only_entry_button(harness):
    page = harness.enrolled_client("Ana Pop").get("/me").text
    assert "Ana Pop" in page
    assert "în afara Sălii" in page
    assert 'action="/me/entry"' in page
    assert 'action="/me/exit"' not in page


def test_entry_confirms_type_and_local_time_then_page_shows_inside(harness):
    phone = harness.enrolled_client("Ana Pop")
    r = phone.post("/me/entry", data=totp(harness))
    assert r.status_code == 200
    assert "Intrare înregistrată la 10:12" in r.text
    page = phone.get("/me").text
    assert "în Sală din 10:12" in page
    assert 'action="/me/exit"' in page
    assert 'action="/me/entry"' not in page


def test_exit_closes_session_and_confirms(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    harness.clock.advance(hours=1, minutes=5)
    r = phone.post("/me/exit", data=totp(harness))
    assert r.status_code == 200
    assert "Ieșire înregistrată la 11:17" in r.text
    page = phone.get("/me").text
    assert "în afara Sălii" in page
    assert 'action="/me/entry"' in page


def test_can_enter_again_after_exit(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    phone.post("/me/exit", data=totp(harness))
    assert phone.post("/me/entry", data=totp(harness)).status_code == 200


def test_double_entry_is_rejected_with_clear_message(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    harness.clock.advance(minutes=10)
    r = phone.post("/me/entry", data=totp(harness))
    assert r.status_code == 409
    assert "Ești deja în Sală din 10:12" in r.text
    assert "Intrare înregistrată" not in r.text


def test_exit_without_session_is_rejected(harness):
    r = harness.enrolled_client("Ana Pop").post("/me/exit", data=totp(harness))
    assert r.status_code == 409
    assert "Nu ai o Intrare deschisă" in r.text


def test_stale_form_after_state_change_is_rejected(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    phone.post("/me/exit", data=totp(harness))
    # formularul de Ieșire rămas deschis într-un tab vechi
    r = phone.post("/me/exit", data=totp(harness))
    assert r.status_code == 409
    assert "Nu ai o Intrare deschisă" in r.text


def test_events_are_in_journal_with_their_utc_moment(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=totp(harness))
    harness.clock.advance(hours=2)
    phone.post("/me/exit", data=totp(harness))
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
    phone.post("/me/exit", data=totp(harness))
    assert "Ieșire: Ana Pop" not in harness.admin_client().get("/api/admin/journal").text


def test_states_are_per_employee(harness):
    ana = harness.enrolled_client("Ana Pop")
    ion = harness.enrolled_client("Ion Vasile")
    ana.post("/me/entry", data=totp(harness))
    assert "în afara Sălii" in ion.get("/me").text
    assert ion.post("/me/entry", data=totp(harness)).status_code == 200


def test_event_routes_require_enrolled_device(harness):
    c = harness.client()
    assert c.post("/me/entry", data=totp(harness)).status_code == 401
    assert c.post("/me/exit", data=totp(harness)).status_code == 401


def test_display_timezone_is_a_setting(make_harness):
    h = make_harness(timezone="UTC")
    phone = h.enrolled_client("Ana Pop")
    assert "Intrare înregistrată la 08:12" in phone.post("/me/entry", data=totp(h)).text
