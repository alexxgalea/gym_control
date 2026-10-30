"""Jurnalul (API JSON `/api/admin/journal`): filtre, etichete, paginare. Doar prin HTTP."""

from datetime import datetime, timezone

from tests.conftest import ADMIN_USER

URL = "/api/admin/journal"


def _event(harness, phone, kind):
    assert phone.post(f"/api/employee/{kind}", json={"totp": harness.current_totp()}).status_code == 200


def _journal(client, query: str = "") -> dict:
    r = client.get(f"{URL}?{query}")
    assert r.status_code == 200, r.text
    return r.json()


def _summaries(client, query: str = "") -> list[str]:
    return [e["summary"] for e in _journal(client, query)["entries"]]


def _employee_id(admin, name: str) -> int:
    return next(e["id"] for e in admin.get("/api/admin/employees").json() if e["name"] == name)


def test_requires_login(harness):
    c = harness.client()
    assert c.get(URL).status_code == 401
    assert c.get(f"{URL}/kinds").status_code == 401


def test_entry_row_has_employee_utc_moment_type_and_method(harness):
    _event(harness, harness.enrolled_client("Ana Pop"), "entry")
    page = _journal(harness.admin_client())
    assert page["timezone"] == "Europe/Bucharest"
    row = next(e for e in page["entries"] if e["summary"] == "Intrare: Ana Pop")
    assert row["employee_name"] == "Ana Pop"
    assert row["at"] == "2026-01-05T08:12:00+00:00"  # UTC; ora locală o afișează SPA-ul
    assert row["kind"] == "entry" and row["kind_label"] == "Intrare"
    assert row["method_label"] == "Cod QR"
    assert row["anomalies"] == [] and row["author"] is None and row["manual"] is False


def test_exit_and_admin_action_with_author(harness):
    phone = harness.enrolled_client("Ana Pop")
    _event(harness, phone, "entry")
    harness.clock.advance(seconds=30)  # codul de la ușă s-a schimbat: o nouă scanare
    _event(harness, phone, "exit")
    rows = _journal(harness.admin_client())["entries"]
    assert any(e["kind_label"] == "Ieșire" for e in rows)
    row = next(e for e in rows if e["summary"] == "Angajat creat: Ana Pop")
    assert row["kind_label"] == "Acțiune Admin" and row["author"] == ADMIN_USER


def test_kinds_lists_every_type_with_romanian_labels(harness):
    kinds = {k["value"]: k["label"] for k in harness.admin_client().get(f"{URL}/kinds").json()}
    assert kinds == {
        "entry": "Intrare", "exit": "Ieșire", "admin_action": "Acțiune Admin",
        "manual_session": "Sesiune manuală", "retention": "Păstrarea datelor", "anomaly": "Anomalie",
        "enrollment": "Activare telefon",
    }


def test_filter_by_employee(harness):
    _event(harness, harness.enrolled_client("Ana Pop"), "entry")
    _event(harness, harness.enrolled_client("Ion Vasile"), "entry")
    admin = harness.admin_client()
    summaries = _summaries(admin, f"employee={_employee_id(admin, 'Ion Vasile')}")
    assert "Intrare: Ion Vasile" in summaries
    assert "Intrare: Ana Pop" not in summaries
    assert "Angajat creat: Ana Pop" not in summaries


def test_filter_by_kind(harness):
    phone = harness.enrolled_client("Ana Pop")
    _event(harness, phone, "entry")
    harness.clock.advance(seconds=30)  # codul de la ușă s-a schimbat: o nouă scanare
    _event(harness, phone, "exit")
    admin = harness.admin_client()
    assert _summaries(admin, "kind=exit") == ["Ieșire: Ana Pop"]
    assert {e["kind"] for e in _journal(admin, "kind=admin_action")["entries"]} == {"admin_action"}


def test_unknown_kind_is_rejected(harness):
    r = harness.admin_client().get(f"{URL}?kind=nu-exista")
    assert r.status_code == 400 and r.json()["detail"] == "Tip necunoscut."


def test_filters_combine(harness):
    ana = harness.enrolled_client("Ana Pop")
    _event(harness, ana, "entry")
    harness.clock.advance(seconds=30)  # codul de la ușă s-a schimbat: o nouă scanare
    _event(harness, ana, "exit")
    _event(harness, harness.enrolled_client("Ion Vasile"), "entry")
    harness.clock.advance(days=1)
    _event(harness, ana, "entry")
    admin = harness.admin_client()
    query = f"employee={_employee_id(admin, 'Ana Pop')}&kind=entry&from=2026-01-05&to=2026-01-05"
    rows = _journal(admin, query)["entries"]
    assert [e["summary"] for e in rows] == ["Intrare: Ana Pop"]
    assert rows[0]["at"].startswith("2026-01-05")


def test_date_interval_is_local_and_inclusive(harness):
    phone = harness.enrolled_client("Ana Pop")
    # 2026-01-05 22:30 UTC = 6 ian 00:30 local (UTC+2)
    harness.clock.set(datetime(2026, 1, 5, 22, 30, tzinfo=timezone.utc))
    _event(harness, phone, "entry")
    harness.clock.set(datetime(2026, 1, 6, 21, 59, tzinfo=timezone.utc))  # 6 ian 23:59 local
    _event(harness, phone, "exit")
    harness.clock.set(datetime(2026, 1, 6, 22, 0, tzinfo=timezone.utc))   # 7 ian 00:00 local
    _event(harness, harness.enrolled_client("Ion Vasile"), "entry")
    summaries = _summaries(harness.admin_client(), "from=2026-01-06&to=2026-01-06")
    assert "Intrare: Ana Pop" in summaries
    assert "Ieșire: Ana Pop" in summaries
    assert "Intrare: Ion Vasile" not in summaries


def test_open_ended_intervals(harness):
    _event(harness, harness.enrolled_client("Ana Pop"), "entry")  # 5 ian
    admin = harness.admin_client()
    assert "Intrare: Ana Pop" in _summaries(admin, "from=2026-01-05")
    assert "Intrare: Ana Pop" not in _summaries(admin, "from=2026-01-06")
    assert "Intrare: Ana Pop" in _summaries(admin, "to=2026-01-05")
    assert "Intrare: Ana Pop" not in _summaries(admin, "to=2026-01-04")


def test_dst_day_boundaries(make_harness, clock):
    # 29 mar 2026: zi de 23 h în București (UTC+2 -> UTC+3 la 03:00)
    h = make_harness()
    clock.set(datetime(2026, 3, 29, 20, 59, tzinfo=timezone.utc))  # 29 mar 23:59 local (+3)
    ana = h.enrolled_client("Ana Pop")
    dan = h.enrolled_client("Dan Ionescu")
    _event(h, ana, "entry")
    clock.set(datetime(2026, 3, 29, 21, 0, tzinfo=timezone.utc))   # 30 mar 00:00 local
    _event(h, dan, "entry")
    summaries = _summaries(h.admin_client(), "from=2026-03-29&to=2026-03-29")
    assert "Intrare: Ana Pop" in summaries
    assert "Intrare: Dan Ionescu" not in summaries


def test_invalid_date_is_a_clear_error(harness):
    r = harness.admin_client().get(f"{URL}?from=nu-e-data")
    assert r.status_code == 400
    assert r.json()["detail"] == "Dată invalidă. Folosește formatul AAAA-LL-ZZ."


def test_reversed_interval_is_rejected(harness):
    r = harness.admin_client().get(f"{URL}?from=2026-01-06&to=2026-01-05")
    assert r.status_code == 400
    assert "Intervalul e invers" in r.json()["detail"]


def test_pagination_caps_rows(harness):
    admin = harness.admin_client()
    for i in range(60):
        harness.create_employee(f"Persoana {i:02d}")
    p1 = _journal(admin)
    assert len(p1["entries"]) == 50 and p1["page"] == 1
    assert p1["has_next"] is True and p1["has_prev"] is False
    p2 = _journal(admin, "page=2")
    assert 0 < len(p2["entries"]) <= 50
    assert p2["has_prev"] is True
    assert _journal(admin, "from=2026-01-01&page=1")["has_next"] is True


def _write(harness, **kw):
    """Scrie direct în Jurnal, cu `detail` bogat (cum fac evenimentele și acțiunile)."""
    from gym_control import journal
    app = harness.admin_client().app
    journal.write(app.state.db, harness.clock(), **kw)
    app.state.db.commit()


def test_anomalies_and_methods_in_detail_are_labelled(harness):
    emp = harness.create_employee("Ana Pop")
    _write(harness, kind="entry", action="entry", summary="Intrare: Ana Pop", employee_id=emp,
           detail={"method": "qr_totp", "anomalies": ["outside_hours", {"label": "Altceva"}]})
    _write(harness, kind="exit", action="exit", summary="Ieșire: Ana Pop", employee_id=emp,
           detail={"method": "manual"})
    _write(harness, kind="entry", action="entry", summary="Intrare veche: Ana Pop", employee_id=emp)
    rows = {e["summary"]: e for e in _journal(harness.admin_client())["entries"]}
    assert rows["Intrare: Ana Pop"]["method_label"] == "Cod QR"
    assert rows["Intrare: Ana Pop"]["anomalies"] == ["Intrare în afara programului", "Altceva"]
    assert rows["Ieșire: Ana Pop"]["method_label"] == "Sesiune manuală"
    assert rows["Intrare veche: Ana Pop"]["method_label"] is None  # lipsă tolerată


def test_anomaly_codes_and_kinds_use_romanian_labels(harness):
    phone = harness.enrolled_client("Ana Pop")
    harness.clock.set(datetime(2026, 1, 5, 21, 30, tzinfo=timezone.utc))  # 23:30 local, în afara programului
    _event(harness, phone, "entry")
    harness.clock.advance(days=1)
    _event(harness, phone, "entry")  # Sesiunea veche devine `missing_exit`
    body = harness.admin_client().get(URL).text
    assert "outside_hours" not in body and "missing_exit" not in body
    rows = _journal(harness.admin_client())["entries"]
    assert any("Intrare în afara programului" in e["anomalies"] for e in rows)
    anomaly = next(e for e in rows if e["kind"] == "anomaly")
    assert anomaly["kind_label"] == "Anomalie" and anomaly["anomalies"] == ["Ieșire lipsă"]
    assert any(e["kind_label"] == "Activare telefon" for e in rows)


def test_manual_session_is_marked_with_author_and_reason(harness):
    emp = harness.create_employee("Ana Pop")
    _write(harness, kind="manual_session", action="session.manual_add", employee_id=emp,
           summary="Sesiune manuală adăugată: Ana Pop. Motiv: Telefon stricat",
           detail={"method": "manual", "reason": "Telefon stricat"})
    row = next(e for e in _journal(harness.admin_client())["entries"] if e["kind"] == "manual_session")
    assert row["manual"] is True and row["kind_label"] == "Sesiune manuală"
    assert row["method_label"] == "Sesiune manuală" and "Telefon stricat" in row["summary"]


def test_spa_takes_over_journal_path_on_direct_load(make_harness, tmp_path):
    (tmp_path / "index.html").write_text("<html>SPA</html>")
    c = make_harness(frontend_dist=str(tmp_path)).admin_client()
    assert c.get("/admin/journal").text == "<html>SPA</html>"
