"""Admin: protecție CSRF (Origin/Referer același-origine) și limitarea încercărilor de login."""

from tests.conftest import ADMIN_PASSWORD, ADMIN_USER


def _login(client, password=ADMIN_PASSWORD, **kw):
    return client.post("/api/admin/login", json={"username": ADMIN_USER, "password": password}, **kw)


def test_admin_post_from_another_origin_is_refused_and_has_no_effect(harness):
    admin = harness.admin_client()
    r = admin.post("/api/admin/employees", json={"name": "Ana Pop", "email": "ana@firma.ro"},
                   headers={"Origin": "http://evil.example"})
    assert r.status_code == 403
    assert admin.get("/api/admin/employees").json() == []


def test_admin_post_without_origin_or_referer_is_refused(harness):
    admin = harness.admin_client()
    r = admin.post("/api/admin/employees", json={"name": "Ana Pop", "email": "ana@firma.ro"},
                   headers={"Origin": ""})
    assert r.status_code == 403


def test_referer_from_same_origin_is_accepted_when_origin_is_missing(harness):
    admin = harness.admin_client()
    r = admin.post("/api/admin/employees", json={"name": "Ana Pop", "email": "ana@firma.ro"},
                   headers={"Origin": "", "Referer": "http://testserver/admin/employees"})
    assert r.status_code == 201


def test_cross_origin_post_is_refused_on_every_admin_router(harness):
    admin = harness.admin_client()
    evil = {"Origin": "http://evil.example"}
    assert admin.post("/api/admin/logout", headers=evil).status_code == 403
    assert admin.post("/api/admin/employees", json={}, headers=evil).status_code == 403
    assert admin.post("/api/admin/sessions", json={}, headers=evil).status_code == 403
    assert admin.post("/api/admin/incidents", json={}, headers=evil).status_code == 403
    assert _login(harness.client(), headers=evil).status_code == 403


def test_get_requests_are_not_subject_to_origin_check(harness):
    admin = harness.admin_client()
    assert admin.get("/api/admin/employees", headers={"Origin": "http://evil.example"}).status_code == 200


def test_repeated_wrong_passwords_lock_the_account_for_that_ip_and_expire(harness):
    c = harness.client()
    for _ in range(5):
        assert _login(c, "gresita").status_code == 401
    r = _login(c)  # parola corectă, dar blocat
    assert r.status_code == 429
    assert r.json()["detail"].startswith("Prea multe încercări eșuate. Încearcă din nou peste ")
    harness.clock.advance(minutes=16)
    assert _login(c).status_code == 200


def test_lockout_is_per_ip_and_username_and_success_resets_counter(harness):
    c = harness.client()
    for _ in range(4):
        _login(c, "gresita")
    assert _login(c).status_code == 200          # reușita șterge contorul
    for _ in range(4):
        assert _login(c, "gresita").status_code == 401
    other = harness.client("192.168.10.77")
    for _ in range(5):
        _login(c, "gresita")
    assert _login(other).status_code == 200      # alt IP nu e afectat
