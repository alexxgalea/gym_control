"""Sesiuni manuale (#12, #21): API JSON `/api/admin/sessions`. Ceasul de test: 2026-01-05 08:12 UTC = 10:12 local (UTC+2)."""


from tests.conftest import ADMIN_USER


def _totp(harness):
    return {"totp": harness.current_totp()}


def _employee(harness, name="Ana Pop"):
    return harness.create_employee(name)


def _add(admin, employee_id, entry, exit_, reason="Telefonul de la ușă nu a funcționat"):
    return admin.post("/api/admin/sessions", json={
        "employee_id": employee_id, "entry_at": entry, "exit_at": exit_, "reason": reason,
    })


def _correct(admin, link, exit_, reason):
    return admin.post(link, json={"exit_at": exit_, "reason": reason})


def _manual_entries(admin):
    return [e for e in admin.get("/api/admin/journal").json()["entries"] if e["manual"]]


def _forgotten_exit(harness):
    """Ana intră ieri, uită Ieșirea, intră din nou azi. Întoarce (telefon, URL de corectare)."""
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/api/employee/entry", json=_totp(harness))
    harness.clock.advance(days=1)
    phone.post("/api/employee/entry", json=_totp(harness))
    [row] = harness.admin_client().get("/api/admin/anomalies").json()
    assert row["exit_at"] is None
    return phone, f"/api/admin/sessions/{row['session_id']}/correct"


def test_session_endpoints_require_admin(harness):
    eid = _employee(harness)
    anon = harness.client()
    assert _add(anon, eid, "2026-01-05T08:00", "2026-01-05T09:00").status_code == 401
    assert _correct(anon, "/api/admin/sessions/1/correct", "2026-01-05T09:00", "x").status_code == 401


def test_old_html_routes_are_gone(harness):
    admin = harness.admin_client()
    assert admin.get("/admin/sessions/new", follow_redirects=False).status_code != 200
    assert admin.post("/admin/sessions", data={}, follow_redirects=False).status_code in (404, 405)


def test_add_without_reason_is_refused_next_to_the_reason_field_and_changes_nothing(harness):
    eid = _employee(harness)
    admin = harness.admin_client()
    for reason in ("", "   "):
        r = _add(admin, eid, "2026-01-05T08:00", "2026-01-05T09:00", reason)
        assert r.status_code == 400
        assert r.json()["field"] == "reason"
        assert "motiv" in r.json()["detail"].lower()
    report = admin.get("/api/admin/reports?from=2026-01-05T00:00&to=2026-01-05T23:59").text
    assert "Ana Pop" not in report
    assert _manual_entries(admin) == []


def test_manual_session_is_marked_in_jurnal_and_raport_with_author_and_reason(harness):
    eid = _employee(harness)
    admin = harness.admin_client()
    r = _add(admin, eid, "2026-01-05T08:00", "2026-01-05T09:30")
    assert r.status_code == 201
    assert isinstance(r.json()["id"], int)
    [entry] = _manual_entries(admin)
    assert entry["kind_label"] == "Sesiune manuală"
    assert entry["method_label"] == "Sesiune manuală"
    assert "Telefonul de la ușă nu a funcționat" in entry["summary"]
    assert entry["author"] == ADMIN_USER
    assert entry["employee_name"] == "Ana Pop"
    [row] = admin.get("/api/admin/reports?from=2026-01-05T00:00&to=2026-01-05T23:59").json()["rows"]
    assert row["employee_name"] == "Ana Pop" and "Sesiune manuală" in row["label"]
    assert row["method_label"] == "Sesiune manuală"
    assert row["entry"] == "2026-01-05T06:00:00+00:00" and row["exit"] == "2026-01-05T07:30:00+00:00"


def test_add_validation_errors_name_the_field(harness):
    eid = _employee(harness)
    admin = harness.admin_client()
    r = _add(admin, eid, "2026-01-05T09:00", "2026-01-05T09:00")
    assert r.status_code == 400 and r.json()["field"] == "exit_at" and "după Intrare" in r.json()["detail"]
    assert _add(admin, eid, "2026-01-05T09:00", "2026-01-05T08:00").status_code == 400
    r = _add(admin, eid, "2026-01-05T09:00", "2026-01-05T10:13")  # 10:12 local acum
    assert r.status_code == 400 and r.json()["field"] == "exit_at" and "viitor" in r.json()["detail"]
    r = _add(admin, 9999, "2026-01-05T08:00", "2026-01-05T09:00")
    assert r.status_code == 400 and r.json()["field"] == "employee_id"
    r = admin.post("/api/admin/sessions", json={
        "employee_id": None, "entry_at": "2026-01-05T08:00", "exit_at": "2026-01-05T09:00", "reason": "x"})
    assert r.status_code == 400 and r.json() == {"detail": "Alege un Angajat.", "field": "employee_id"}
    r = _add(admin, eid, "", "2026-01-05T09:00")
    assert r.status_code == 400 and r.json()["field"] == "entry_at" and "Intrare" in r.json()["detail"]
    r = _add(admin, eid, "2026-01-05T08:00", "azi")
    assert r.status_code == 400 and r.json()["field"] == "exit_at" and "invalide" in r.json()["detail"]
    assert _manual_entries(admin) == []


def test_overlapping_manual_session_is_rejected(harness):
    eid = _employee(harness)
    admin = harness.admin_client()
    assert _add(admin, eid, "2026-01-05T08:00", "2026-01-05T09:00").status_code == 201
    r = _add(admin, eid, "2026-01-05T08:30", "2026-01-05T09:30")
    assert r.status_code == 400 and "suprapune" in r.json()["detail"]
    assert r.json()["field"] == "entry_at"
    assert _add(admin, eid, "2026-01-05T09:00", "2026-01-05T09:30").status_code == 201  # adiacent
    other = _employee(harness, "Ion Vasile")
    assert _add(admin, other, "2026-01-05T08:30", "2026-01-05T09:30").status_code == 201


def test_manual_session_does_not_block_or_open_presence(harness):
    phone = harness.enrolled_client("Ana Pop")
    admin = harness.admin_client()
    eid = admin.get("/api/admin/employees").json()[0]["id"]
    assert _add(admin, eid, "2026-01-05T06:00", "2026-01-05T07:00").status_code == 201
    assert phone.get("/api/employee/me").json()["inside_since"] is None
    assert phone.post("/api/employee/entry", json=_totp(harness)).status_code == 200
    harness.clock.advance(seconds=30)  # codul de la ușă s-a schimbat: o nouă scanare
    assert phone.post("/api/employee/exit", json=_totp(harness)).status_code == 200


def test_correct_forgotten_exit_closes_session_and_resolves_anomaly(harness):
    phone, link = _forgotten_exit(harness)
    admin = harness.admin_client()
    r = _correct(admin, link, "2026-01-05T18:00", "Ieșire uitată")
    assert r.status_code == 204, r.text
    assert admin.get("/api/admin/anomalies").json() == []
    # Ana poate continua normal: Ieșire din Sesiunea curentă, apoi Intrare
    harness.clock.advance(seconds=30)  # codul de la ușă s-a schimbat: o nouă scanare
    assert phone.post("/api/employee/exit", json=_totp(harness)).status_code == 200
    harness.clock.advance(seconds=30)  # codul de la ușă s-a schimbat: o nouă scanare
    assert phone.post("/api/employee/exit", json=_totp(harness)).status_code == 409  # cea veche nu se redeschide
    harness.clock.advance(seconds=30)  # codul de la ușă s-a schimbat: o nouă scanare
    assert phone.post("/api/employee/entry", json=_totp(harness)).status_code == 200
    [entry] = _manual_entries(admin)
    assert "Ieșire uitată" in entry["summary"]
    assert entry["method_label"] == "Sesiune manuală" and entry["author"] == ADMIN_USER
    report = admin.get("/api/admin/reports?from=2026-01-05T00:00&to=2026-01-05T23:59").text
    assert "Sesiune manuală" in report and "2026-01-05T16:00:00+00:00" in report


def test_correct_requires_reason_and_valid_exit(harness):
    _, link = _forgotten_exit(harness)
    admin = harness.admin_client()
    r = _correct(admin, link, "2026-01-05T18:00", "  ")
    assert r.status_code == 400 and r.json()["field"] == "reason" and "motiv" in r.json()["detail"].lower()
    r = _correct(admin, link, "2026-01-05T09:00", "x")  # înainte de Intrare
    assert r.status_code == 400 and r.json()["field"] == "exit_at"
    assert _correct(admin, link, "2026-01-07T09:00", "x").status_code == 400  # în viitor
    assert _correct(admin, link, "", "x").json()["field"] == "exit_at"
    assert [a["code"] for a in admin.get("/api/admin/anomalies").json()] == ["missing_exit"]
    assert _manual_entries(admin) == []


def test_correct_exit_cannot_overlap_the_next_session(harness):
    _, link = _forgotten_exit(harness)  # Intrarea nouă: 2026-01-06 10:12 local, deschisă
    harness.clock.advance(hours=1)
    r = _correct(harness.admin_client(), link, "2026-01-06T10:30", "x")
    assert r.status_code == 400 and "suprapune" in r.json()["detail"]


def test_correct_closed_or_missing_session_is_refused(harness):
    _, link = _forgotten_exit(harness)
    admin = harness.admin_client()
    assert _correct(admin, link, "2026-01-05T18:00", "x").status_code == 204
    r = _correct(admin, link, "2026-01-05T19:00", "x")
    assert r.status_code == 409 and r.json()["detail"] == "Sesiunea e deja închisă."
    assert _correct(admin, "/api/admin/sessions/9999/correct", "2026-01-05T19:00", "x").status_code == 404


def test_correct_session_flagged_open_at_closing_resolves_it(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/api/employee/entry", json=_totp(harness))
    harness.clock.advance(hours=12)  # 22:12 local, după închidere
    harness.tick()
    admin = harness.admin_client()
    [row] = admin.get("/api/admin/anomalies").json()
    assert row["code"] == "open_at_closing"
    r = _correct(admin, f"/api/admin/sessions/{row['session_id']}/correct", "2026-01-05T18:00", "Plecat la 18")
    assert r.status_code == 204
    assert admin.get("/api/admin/anomalies").json() == []
