from tests.conftest import HALL_IP, OUTSIDE_IP


def test_status_page_responds(harness):
    r = harness.client().get("/status")
    assert r.status_code == 200
    assert "Gym Control" in r.text


def test_status_shows_injected_clock(harness):
    r = harness.client().get("/status")
    assert "2026-01-05T08:12:00+00:00" in r.text

    harness.clock.advance(minutes=30)
    r = harness.client().get("/status")
    assert "2026-01-05T08:42:00+00:00" in r.text


def test_status_reflects_source_ip_against_configured_subnet(harness):
    assert "în rețeaua Sălii" in harness.client(HALL_IP).get("/status").text
    assert "în afara rețelei Sălii" in harness.client(OUTSIDE_IP).get("/status").text


def test_status_uses_injected_configuration(make_harness):
    h = make_harness(hall_subnet="10.0.0.0/24")
    assert "în rețeaua Sălii" in h.client(OUTSIDE_IP).get("/status").text
    assert "în afara rețelei Sălii" in h.client(HALL_IP).get("/status").text
