from tests.conftest import HALL_IP, OUTSIDE_IP


def test_status_json_reports_hall_network_and_server_time(harness):
    r = harness.client(HALL_IP).get("/api/employee/status")
    assert r.status_code == 200
    assert r.json() == {
        "in_hall": True,
        "server_time": "2026-01-05T08:12:00+00:00",
        "time_zone": "Europe/Bucharest",
    }


def test_status_shows_injected_clock(harness):
    assert harness.client().get("/api/employee/status").json()["server_time"] == "2026-01-05T08:12:00+00:00"
    harness.clock.advance(minutes=30)
    assert harness.client().get("/api/employee/status").json()["server_time"] == "2026-01-05T08:42:00+00:00"


def test_status_reflects_source_ip_against_configured_subnet(harness):
    assert harness.client(HALL_IP).get("/api/employee/status").json()["in_hall"] is True
    r = harness.client(OUTSIDE_IP).get("/api/employee/status")
    assert r.status_code == 200  # Verificarea conexiunii răspunde și din afara rețelei: asta e rostul ei
    assert r.json()["in_hall"] is False


def test_status_uses_injected_configuration(make_harness):
    h = make_harness(hall_subnet="10.0.0.0/24")
    assert h.client(OUTSIDE_IP).get("/api/employee/status").json()["in_hall"] is True
    assert h.client(HALL_IP).get("/api/employee/status").json()["in_hall"] is False


def test_status_page_serves_the_employee_entry_point(make_harness, tmp_path):
    (tmp_path / "index.html").write_text("<title>admin</title>")
    (tmp_path / "employee.html").write_text("<title>angajat</title>")
    c = make_harness(frontend_dist=str(tmp_path)).client()
    r = c.get("/status")
    assert r.status_code == 200
    assert "angajat" in r.text
    assert "admin" not in r.text


def test_me_page_serves_the_employee_entry_point(make_harness, tmp_path):
    (tmp_path / "index.html").write_text("<title>admin</title>")
    (tmp_path / "employee.html").write_text("<title>angajat</title>")
    r = make_harness(frontend_dist=str(tmp_path)).client().get("/me?t=12345678")
    assert r.status_code == 200
    assert "angajat" in r.text


def test_other_employee_pages_stay_on_legacy_html(make_harness, tmp_path):
    (tmp_path / "index.html").write_text("<title>admin</title>")
    (tmp_path / "employee.html").write_text("<title>angajat</title>")
    c = make_harness(frontend_dist=str(tmp_path)).client()
    assert "angajat" not in c.get("/door").text
