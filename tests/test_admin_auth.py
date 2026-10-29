from tests.conftest import ADMIN_PASSWORD, ADMIN_USER


def test_admin_screen_without_login_is_refused(harness):
    r = harness.client().get("/admin/employees", follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/admin/login"


def test_admin_screen_with_bogus_cookie_is_refused(harness):
    c = harness.client()
    c.cookies.set("gc_admin", "nu-e-o-sesiune")
    assert c.get("/admin/employees", follow_redirects=False).status_code == 303


def test_login_with_wrong_password_is_rejected(harness):
    c = harness.client()
    r = c.post("/admin/login", data={"username": ADMIN_USER, "password": "gresit"})
    assert r.status_code == 401
    assert "Cont sau parolă greșite" in r.text
    assert c.get("/admin/employees", follow_redirects=False).status_code == 303


def test_login_with_unknown_account_is_rejected(harness):
    r = harness.client().post(
        "/admin/login", data={"username": "altcineva", "password": ADMIN_PASSWORD}
    )
    assert r.status_code == 401


def test_login_grants_access_and_logout_removes_it(harness):
    c = harness.admin_client()
    assert c.get("/admin/employees").status_code == 200
    r = c.post("/admin/logout", follow_redirects=False)
    assert r.status_code == 303
    assert c.get("/admin/employees", follow_redirects=False).status_code == 303


def test_session_expires_with_the_clock(harness):
    c = harness.admin_client()
    harness.clock.advance(hours=13)
    assert c.get("/admin/employees", follow_redirects=False).status_code == 303


def test_login_page_is_reachable_and_mobile_friendly(harness):
    r = harness.client().get("/admin/login")
    assert r.status_code == 200
    assert 'name="viewport"' in r.text


def test_password_is_not_echoed_in_pages(harness):
    c = harness.admin_client()
    assert ADMIN_PASSWORD not in c.get("/admin/employees").text
