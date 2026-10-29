"""Sesiuni manuale (#12). Ceasul de test: 2026-01-05 08:12 UTC = 10:12 local (UTC+2)."""


from tests.conftest import ADMIN_USER


def _totp(harness):
    return {"totp": harness.current_totp()}


def _employee(harness, name="Ana Pop"):
    return harness.create_employee(name)


def _add(admin, employee_id, entry, exit_, reason="Telefonul de la ușă nu a funcționat"):
    return admin.post("/admin/sessions", data={
        "employee_id": employee_id, "entry_at": entry, "exit_at": exit_, "reason": reason,
    }, follow_redirects=False)


def _forgotten_exit(harness):
    """Ana intră ieri, uită Ieșirea, intră din nou azi. Întoarce (telefon, link de corectare)."""
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=_totp(harness))
    harness.clock.advance(days=1)
    phone.post("/me/entry", data=_totp(harness))
    [row] = harness.admin_client().get("/api/admin/anomalies").json()
    assert row["exit_at"] is None
    return phone, f"/admin/sessions/{row['session_id']}/correct"


def test_new_session_screen_requires_admin_and_is_narrow_friendly(harness):
    assert harness.client().get("/admin/sessions/new", follow_redirects=False).status_code in (303, 401)
    _employee(harness)
    page = harness.admin_client().get("/admin/sessions/new").text
    assert "Ana Pop" in page and 'name="reason"' in page
    assert "viewport" in page


def test_add_without_reason_is_refused_and_changes_nothing(harness):
    eid = _employee(harness)
    admin = harness.admin_client()
    for reason in ("", "   "):
        r = _add(admin, eid, "2026-01-05T08:00", "2026-01-05T09:00", reason)
        assert r.status_code == 400
        assert "motiv" in r.text.lower()
    report = admin.get("/admin/reports?from=2026-01-05T00:00&to=2026-01-05T23:59").text
    assert "Ana Pop" not in report
    assert "Sesiune manuală" not in admin.get("/api/admin/journal").text


def test_manual_session_is_marked_in_jurnal_and_raport_with_author_and_reason(harness):
    eid = _employee(harness)
    admin = harness.admin_client()
    r = _add(admin, eid, "2026-01-05T08:00", "2026-01-05T09:30")
    assert r.status_code == 303
    jurnal = admin.get("/api/admin/journal").text
    assert "Sesiune manuală" in jurnal
    assert "Introdus manual" in jurnal
    assert "Telefonul de la ușă nu a funcționat" in jurnal
    assert ADMIN_USER in jurnal
    report = admin.get("/admin/reports?from=2026-01-05T00:00&to=2026-01-05T23:59").text
    assert "Ana Pop" in report and "Sesiune manuală" in report
    assert "2026-01-05 08:00" in report and "2026-01-05 09:30" in report


def test_add_validation_exit_after_entry_not_future_employee_exists(harness):
    eid = _employee(harness)
    admin = harness.admin_client()
    assert _add(admin, eid, "2026-01-05T09:00", "2026-01-05T09:00").status_code == 400
    assert _add(admin, eid, "2026-01-05T09:00", "2026-01-05T08:00").status_code == 400
    r = _add(admin, eid, "2026-01-05T09:00", "2026-01-05T10:13")  # 10:12 local acum
    assert r.status_code == 400 and "viitor" in r.text
    assert _add(admin, 9999, "2026-01-05T08:00", "2026-01-05T09:00").status_code in (400, 404)
    assert _add(admin, eid, "", "2026-01-05T09:00").status_code == 400
    assert "Sesiune manuală" not in admin.get("/api/admin/journal").text


def test_overlapping_manual_session_is_rejected(harness):
    eid = _employee(harness)
    admin = harness.admin_client()
    assert _add(admin, eid, "2026-01-05T08:00", "2026-01-05T09:00").status_code == 303
    r = _add(admin, eid, "2026-01-05T08:30", "2026-01-05T09:30")
    assert r.status_code == 400 and "suprapune" in r.text
    assert _add(admin, eid, "2026-01-05T09:00", "2026-01-05T09:30").status_code == 303  # adiacent
    other = _employee(harness, "Ion Vasile")
    assert _add(admin, other, "2026-01-05T08:30", "2026-01-05T09:30").status_code == 303


def test_manual_session_does_not_block_or_open_presence(harness):
    phone = harness.enrolled_client("Ana Pop")
    admin = harness.admin_client()
    eid = admin.get("/api/admin/employees").json()[0]["id"]
    assert _add(admin, eid, "2026-01-05T06:00", "2026-01-05T07:00").status_code == 303
    assert "în afara Sălii" in phone.get("/me").text
    assert phone.post("/me/entry", data=_totp(harness)).status_code == 200
    assert phone.post("/me/exit", data=_totp(harness)).status_code == 200


def test_correct_forgotten_exit_closes_session_and_resolves_anomaly(harness):
    phone, link = _forgotten_exit(harness)
    admin = harness.admin_client()
    form = admin.get(link)
    assert form.status_code == 200 and 'name="reason"' in form.text
    r = admin.post(link, data={"exit_at": "2026-01-05T18:00", "reason": "Ieșire uitată"},
                   follow_redirects=False)
    assert r.status_code == 303, r.text
    assert admin.get("/api/admin/anomalies").json() == []
    # Ana poate continua normal: Ieșire din Sesiunea curentă, apoi Intrare
    assert phone.post("/me/exit", data=_totp(harness)).status_code == 200
    assert phone.post("/me/exit", data=_totp(harness)).status_code == 409  # cea veche nu se redeschide
    assert phone.post("/me/entry", data=_totp(harness)).status_code == 200
    jurnal = admin.get("/api/admin/journal").text
    assert "Ieșire uitată" in jurnal and "Introdus manual" in jurnal and ADMIN_USER in jurnal
    report = admin.get("/admin/reports?from=2026-01-05T00:00&to=2026-01-05T23:59").text
    assert "Sesiune manuală" in report and "2026-01-05 18:00" in report


def test_correct_requires_reason_and_valid_exit(harness):
    _, link = _forgotten_exit(harness)
    admin = harness.admin_client()
    r = admin.post(link, data={"exit_at": "2026-01-05T18:00", "reason": "  "})
    assert r.status_code == 400 and "motiv" in r.text.lower()
    assert admin.post(link, data={"exit_at": "2026-01-05T09:00", "reason": "x"}).status_code == 400  # înainte de Intrare
    assert admin.post(link, data={"exit_at": "2026-01-07T09:00", "reason": "x"}).status_code == 400  # în viitor
    assert [a["code"] for a in admin.get("/api/admin/anomalies").json()] == ["missing_exit"]


def test_correct_exit_cannot_overlap_the_next_session(harness):
    _, link = _forgotten_exit(harness)  # Intrarea nouă: 2026-01-06 10:12 local, deschisă
    harness.clock.advance(hours=1)
    r = harness.admin_client().post(link, data={"exit_at": "2026-01-06T10:30", "reason": "x"})
    assert r.status_code == 400 and "suprapune" in r.text


def test_correct_closed_or_missing_session_is_refused(harness):
    _, link = _forgotten_exit(harness)
    admin = harness.admin_client()
    assert admin.post(link, data={"exit_at": "2026-01-05T18:00", "reason": "x"},
                      follow_redirects=False).status_code == 303
    assert admin.post(link, data={"exit_at": "2026-01-05T19:00", "reason": "x"}).status_code == 409
    assert admin.get("/admin/sessions/9999/correct").status_code == 404


def test_correct_session_flagged_open_at_closing_resolves_it(harness):
    phone = harness.enrolled_client("Ana Pop")
    phone.post("/me/entry", data=_totp(harness))
    harness.clock.advance(hours=12)  # 22:12 local, după închidere
    harness.tick()
    admin = harness.admin_client()
    [row] = admin.get("/api/admin/anomalies").json()
    assert row["code"] == "open_at_closing"
    assert admin.post(f"/admin/sessions/{row['session_id']}/correct", data={"exit_at": "2026-01-05T18:00", "reason": "Plecat la 18"},
                      follow_redirects=False).status_code == 303
    assert admin.get("/api/admin/anomalies").json() == []
