"""Autentificarea Adminului prin API-ul JSON: login, identitate, logout, sesiune, SPA servit la /admin/."""

from tests.conftest import ADMIN_PASSWORD, ADMIN_USER


def _login(client, username=ADMIN_USER, password=ADMIN_PASSWORD):
    return client.post("/api/admin/login", json={"username": username, "password": password})


def test_login_with_correct_credentials_returns_the_account(harness):
    c = harness.client()
    r = _login(c)
    assert r.status_code == 200
    assert r.json() == {"username": ADMIN_USER}
    assert "HttpOnly" in r.headers["set-cookie"] and "SameSite=lax" in r.headers["set-cookie"]


def test_me_returns_the_logged_in_account(harness):
    assert harness.admin_client().get("/api/admin/me").json() == {"username": ADMIN_USER}


def test_me_without_session_is_401_json(harness):
    r = harness.client().get("/api/admin/me")
    assert r.status_code == 401
    assert r.json()["detail"]


def test_me_with_bogus_cookie_is_401(harness):
    c = harness.client()
    c.cookies.set("gc_admin", "nu-e-o-sesiune")
    assert c.get("/api/admin/me").status_code == 401


def test_login_with_wrong_password_is_401_with_message(harness):
    c = harness.client()
    r = _login(c, password="gresit")
    assert r.status_code == 401
    assert r.json() == {"detail": "Cont sau parolă greșite."}
    assert c.get("/api/admin/me").status_code == 401


def test_login_with_unknown_account_is_401(harness):
    assert _login(harness.client(), username="altcineva").status_code == 401


def test_logout_closes_the_session(harness):
    c = harness.admin_client()
    r = c.post("/api/admin/logout")
    assert r.status_code == 204
    assert c.get("/api/admin/me").status_code == 401


def test_session_expires_with_the_clock(harness):
    c = harness.admin_client()
    harness.clock.advance(hours=13)
    assert c.get("/api/admin/me").status_code == 401


def test_journal_api_requires_login(harness):
    assert harness.client().get("/api/admin/journal").status_code == 401


def test_session_from_json_login_opens_journal_api(harness):
    assert harness.admin_client().get("/api/admin/journal").status_code == 200


def test_spa_is_served_under_admin_with_fallback_to_index(make_harness, tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>SPA</html>")
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    c = make_harness(frontend_dist=str(tmp_path)).client()
    assert c.get("/admin/").text == "<html>SPA</html>"
    assert c.get("/admin/login").text == "<html>SPA</html>"
    assert c.get("/admin/assets/app.js").text == "console.log(1)"
    assert c.get("/admin/assets/lipsa.js").status_code == 404
    # redirecționarea vechii rute a Jurnalului are prioritate față de catch-all
    r = c.get("/admin/jurnal", follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"] == "/admin/journal"
