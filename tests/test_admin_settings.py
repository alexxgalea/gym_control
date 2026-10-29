"""Setări Admin prin API-ul JSON (`/api/admin/settings`), seamul HTTP (#25)."""

from tests.conftest import OUTSIDE_IP

URL = "/api/admin/settings"
VALID = {"hall_subnet": "192.168.10.0/24", "opening_time": "06:00", "closing_time": "22:00"}


def test_settings_require_admin(harness):
    c = harness.client()
    assert c.get(URL).status_code == 401
    assert c.put(URL, json=VALID).status_code == 401


def test_settings_are_not_restricted_by_subnet(harness):
    assert harness.admin_client(OUTSIDE_IP).get(URL).status_code == 200


def test_settings_show_defaults_from_configuration(make_harness):
    h = make_harness(hall_subnet="172.16.0.0/16")
    r = h.admin_client().get(URL)
    assert r.status_code == 200
    assert r.json() == {"hall_subnet": "172.16.0.0/16", "opening_time": "06:00",
                        "closing_time": "22:00", "retention_months": 12}


def test_saving_returns_and_stores_new_values(harness):
    admin = harness.admin_client()
    r = admin.put(URL, json={"hall_subnet": "10.0.0.0/24", "opening_time": "07:30",
                             "closing_time": "21:15", "retention_months": "18"})
    assert r.status_code == 200
    expected = {"hall_subnet": "10.0.0.0/24", "opening_time": "07:30",
                "closing_time": "21:15", "retention_months": 18}
    assert r.json() == expected
    assert admin.get(URL).json() == expected


def test_missing_retention_keeps_current_value(harness):
    admin = harness.admin_client()
    admin.put(URL, json={**VALID, "retention_months": "24"})
    assert admin.put(URL, json=VALID).json()["retention_months"] == 24


def test_changing_subnet_applies_immediately(harness):
    phone = harness.enrolled_client("Ana Pop")
    admin = harness.admin_client()
    assert admin.put(URL, json={**VALID, "hall_subnet": "10.0.0.0/24"}).status_code == 200
    # telefonul din vechea subrețea este acum respins, cel din noua subrețea acceptat
    assert phone.post("/me/entry", data={"totp": harness.current_totp()}).status_code == 403
    phone_new = harness.client(OUTSIDE_IP)
    phone_new.cookies.update(phone.cookies)
    assert phone_new.post("/me/entry", data={"totp": harness.current_totp()}).status_code == 200
    assert "în rețeaua Sălii" in harness.client(OUTSIDE_IP).get("/status").text


def test_invalid_values_report_every_error_by_field_and_save_nothing(harness):
    admin = harness.admin_client()
    r = admin.put(URL, json={"hall_subnet": "nu-e-ip", "opening_time": "25:99", "closing_time": "abc"})
    assert r.status_code == 400
    by_field = {e["field"]: e["detail"] for e in r.json()["errors"]}
    assert "Rețeaua Wi-Fi a Sălii nu e validă" in by_field["hall_subnet"]
    assert "Ora de deschidere nu e validă" in by_field["opening_time"]
    assert "Ora de închidere nu e validă" in by_field["closing_time"]
    assert r.json()["detail"] == r.json()["errors"][0]["detail"]
    assert r.json()["field"] == r.json()["errors"][0]["field"]
    assert admin.get(URL).json()["hall_subnet"] == "192.168.10.0/24"


def test_opening_must_be_before_closing(harness):
    r = harness.admin_client().put(URL, json={**VALID, "opening_time": "22:00", "closing_time": "06:00"})
    assert r.status_code == 400
    [error] = r.json()["errors"]
    assert error["field"] == "closing_time"
    assert "înainte de ora de închidere" in error["detail"]


def test_invalid_retention_is_rejected_by_field(harness):
    admin = harness.admin_client()
    for bad in ("0", "-3", "abc", "1.5"):
        r = admin.put(URL, json={**VALID, "retention_months": bad})
        assert r.status_code == 400, bad
        assert r.json()["errors"][0]["field"] == "retention_months"
        assert "Păstrarea datelor nu e validă" in r.json()["errors"][0]["detail"]
    assert admin.get(URL).json()["retention_months"] == 12


def test_settings_changes_are_journaled_with_author(harness):
    admin = harness.admin_client()
    admin.put(URL, json={**VALID, "hall_subnet": "10.1.0.0/16", "closing_time": "20:00",
                         "retention_months": "18"})
    page = admin.get("/api/admin/journal").text
    assert "Setări modificate" in page
    assert "10.1.0.0/16" in page and "20:00" in page and "12 → 18" in page
    assert "admin" in page


def test_saving_unchanged_settings_writes_no_journal_line(harness):
    admin = harness.admin_client()
    assert admin.put(URL, json=VALID).status_code == 200
    assert "Setări modificate" not in admin.get("/api/admin/journal").text


def test_save_requires_same_origin(harness):
    admin = harness.admin_client()
    r = admin.put(URL, json=VALID, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403


def test_validation_messages_use_plain_language(harness):
    r = harness.admin_client().put(
        URL, json={"hall_subnet": "x", "opening_time": "x", "closing_time": "x", "retention_months": "x"})
    text = " ".join(e["detail"] for e in r.json()["errors"])
    for technical in ("CIDR", "HH:MM", "Subrețea", "retenți"):
        assert technical not in text


# --- sugestia de rețea ------------------------------------------------------------------

SUGGESTION = "/api/admin/settings/network-suggestion"


def test_network_suggestion_requires_admin(harness):
    assert harness.client().get(SUGGESTION).status_code == 401


def test_network_suggestion_for_ipv4_is_the_slash_24_of_the_request(harness):
    r = harness.admin_client("10.20.30.40").get(SUGGESTION)
    assert r.status_code == 200
    assert r.json() == {"address": "10.20.30.40", "network": "10.20.30.0/24", "message": None}


def test_network_suggestion_does_not_save_anything(harness):
    admin = harness.admin_client("10.20.30.40")
    admin.get(SUGGESTION)
    assert admin.get(URL).json()["hall_subnet"] == "192.168.10.0/24"


def test_network_suggestion_for_other_address_type_explains_itself(harness):
    r = harness.admin_client("2001:db8::1").get(SUGGESTION)
    assert r.status_code == 200
    body = r.json()
    assert body["address"] == "2001:db8::1" and body["network"] is None
    assert body["message"] and "IPv4" not in body["message"] and "CIDR" not in body["message"]
