def test_enrolled_phone_is_identified_by_cookie(harness):
    phone = harness.enrolled_client("Ana Pop")
    r = phone.get("/me")
    assert r.status_code == 200
    assert "Ana Pop" in r.text


def test_employee_without_cookie_is_told_to_enrol(harness):
    r = harness.client().get("/me")
    assert r.status_code == 401
    assert "trebuie să te înrolezi" in r.text


def test_link_works_only_once(harness):
    eid = harness.create_employee("Ana Pop")
    link = harness.issue_enroll_link(eid)
    harness.enroll(link)
    second = harness.client()
    assert second.get(link).status_code == 410
    r = second.post(link, follow_redirects=False)
    assert r.status_code == 410
    assert second.get("/me").status_code == 401


def test_opening_link_without_confirming_does_not_consume_it(harness):
    link = harness.issue_enroll_link(harness.create_employee("Ana Pop"))
    harness.client().get(link)  # ex. previzualizare de mesagerie
    assert "Ana Pop" in harness.enroll(link).get("/me").text


def test_unknown_link_is_rejected(harness):
    assert harness.client().get("/enroll/nu-exista").status_code == 410


def test_link_expires(harness):
    link = harness.issue_enroll_link(harness.create_employee("Ana Pop"))
    harness.clock.advance(days=3)
    assert harness.client().get(link).status_code == 410


def test_cookie_identifies_the_right_employee(harness):
    ana = harness.enrolled_client("Ana Pop")
    ion = harness.enrolled_client("Ion Vasile")
    assert "Ana Pop" in ana.get("/me").text
    assert "Ion Vasile" in ion.get("/me").text
    assert "Ion Vasile" not in ana.get("/me").text


def test_client_sent_id_is_ignored(harness):
    harness.enrolled_client("Ion Vasile")
    stranger = harness.client()
    assert stranger.get("/me?employee_id=1").status_code == 401
    assert stranger.get("/me", headers={"X-Employee-Id": "1"}).status_code == 401


def test_forged_cookie_is_rejected(harness):
    c = harness.client()
    c.cookies.set("gc_device", "inventat")
    assert c.get("/me").status_code == 401


def test_re_enrolment_invalidates_old_device(harness):
    eid = harness.create_employee("Ana Pop")
    old = harness.enroll(harness.issue_enroll_link(eid))
    new = harness.enroll(harness.issue_enroll_link(eid))
    assert old.get("/me").status_code == 401
    assert "Ana Pop" in new.get("/me").text


def test_issuing_new_link_voids_previous_unused_link(harness):
    eid = harness.create_employee("Ana Pop")
    first = harness.issue_enroll_link(eid)
    second = harness.issue_enroll_link(eid)
    assert harness.client().get(first).status_code == 410
    assert harness.client().get(second).status_code == 200


def test_revocation_invalidates_device(harness):
    eid = harness.create_employee("Ana Pop")
    phone = harness.enroll(harness.issue_enroll_link(eid))
    r = harness.admin_client().post(f"/api/admin/employees/{eid}/revoke")
    assert r.status_code == 204
    assert phone.get("/me").status_code == 401


def test_enrol_screens_require_admin(harness):
    eid = harness.create_employee("Ana Pop")
    c = harness.client()
    for path in (f"/api/admin/employees/{eid}/enroll-link", f"/api/admin/employees/{eid}/revoke"):
        assert c.post(path).status_code == 401


def test_admin_enrolment_actions_are_in_journal_with_author(harness):
    eid = harness.create_employee("Ana Pop")
    admin = harness.admin_client()
    harness.enroll(harness.issue_enroll_link(eid, admin))
    admin.post(f"/api/admin/employees/{eid}/revoke")
    page = admin.get("/admin/jurnal").text
    assert "Link de înrolare generat pentru Ana Pop" in page
    assert "Dispozitiv revocat pentru Ana Pop" in page
    assert "Dispozitiv înrolat" in page
