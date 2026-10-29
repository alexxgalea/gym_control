"""Ecranul Jurnal (#10): filtre, coloane, paginare. Doar prin HTTP."""

import re
from datetime import datetime, timezone

from tests.conftest import ADMIN_USER


def _rows(html: str) -> list[str]:
    return re.findall(r'<tr class="j-row".*?</tr>', html, re.S)


def _event(harness, phone, kind):
    assert phone.post(f"/me/{kind}").status_code == 200


def test_row_shows_employee_moment_type_and_method(harness):
    phone = harness.enrolled_client("Ana Pop")
    _event(harness, phone, "entry")
    page = harness.admin_client().get("/admin/jurnal").text
    row = next(r for r in _rows(page) if "Intrare: Ana Pop" in r)
    assert 'data-label="Angajat">Ana Pop' in row
    assert "2026-01-05 10:12" in row          # ora locală
    assert "2026-01-05 08:12 UTC" in row      # UTC vizibil
    assert 'data-label="Tip">Intrare' in row
    assert "Fără validare" in row             # metoda 'none'
    assert 'data-label="Anomalii"' in row


def test_exit_type_and_admin_action_with_author(harness):
    phone = harness.enrolled_client("Ana Pop")
    _event(harness, phone, "entry")
    _event(harness, phone, "exit")
    page = harness.admin_client().get("/admin/jurnal").text
    assert any('data-label="Tip">Ieșire' in r for r in _rows(page))
    row = next(r for r in _rows(page) if "Angajat creat: Ana Pop" in r)
    assert "Acțiune Admin" in row
    assert f'data-label="Autor">{ADMIN_USER}' in row


def test_filter_by_employee(harness):
    ana = harness.enrolled_client("Ana Pop")
    ion = harness.enrolled_client("Ion Vasile")
    ana_id = harness.create_employee("Zoe Alt")  # nu are evenimente
    _event(harness, ana, "entry")
    _event(harness, ion, "entry")
    admin = harness.admin_client()
    page = admin.get("/admin/jurnal").text
    m = re.search(r'<option value="(\d+)"[^>]*>Ion Vasile</option>', page)
    assert m
    filtered = admin.get(f"/admin/jurnal?employee={m.group(1)}").text
    assert "Intrare: Ion Vasile" in filtered
    assert "Intrare: Ana Pop" not in filtered
    assert "Angajat creat: Ana Pop" not in filtered
    assert 'selected' in filtered


def test_date_interval_is_local_and_inclusive(harness):
    phone = harness.enrolled_client("Ana Pop")
    # 2026-01-05 22:30 UTC = 6 ian 00:30 local (UTC+2)
    harness.clock.set(datetime(2026, 1, 5, 22, 30, tzinfo=timezone.utc))
    _event(harness, phone, "entry")
    harness.clock.set(datetime(2026, 1, 6, 21, 59, tzinfo=timezone.utc))  # 6 ian 23:59 local
    _event(harness, phone, "exit")
    harness.clock.set(datetime(2026, 1, 6, 22, 0, tzinfo=timezone.utc))   # 7 ian 00:00 local
    phone2 = harness.enrolled_client("Ion Vasile")
    _event(harness, phone2, "entry")
    admin = harness.admin_client()
    page = admin.get("/admin/jurnal?from=2026-01-06&to=2026-01-06").text
    assert "Intrare: Ana Pop" in page      # 00:30 local, ziua 6
    assert "Ieșire: Ana Pop" in page       # 23:59 local, ziua 6
    assert "Intrare: Ion Vasile" not in page  # 00:00 pe 7


def test_open_ended_intervals(harness):
    phone = harness.enrolled_client("Ana Pop")
    _event(harness, phone, "entry")  # 5 ian
    admin = harness.admin_client()
    assert "Intrare: Ana Pop" in admin.get("/admin/jurnal?from=2026-01-05").text
    assert "Intrare: Ana Pop" not in admin.get("/admin/jurnal?from=2026-01-06").text
    assert "Intrare: Ana Pop" in admin.get("/admin/jurnal?to=2026-01-05").text
    assert "Intrare: Ana Pop" not in admin.get("/admin/jurnal?to=2026-01-04").text


def test_dst_day_boundaries(make_harness, clock):
    # 29 mar 2026: zi de 23 h în București (UTC+2 -> UTC+3 la 03:00)
    h = make_harness()
    clock.set(datetime(2026, 3, 29, 20, 59, tzinfo=timezone.utc))  # 29 mar 23:59 local (+3)
    phone = h.enrolled_client("Ana Pop")
    _event(h, phone, "entry")
    clock.set(datetime(2026, 3, 29, 21, 0, tzinfo=timezone.utc))   # 30 mar 00:00 local
    _event(h, phone, "exit")
    admin = h.admin_client()
    page = admin.get("/admin/jurnal?from=2026-03-29&to=2026-03-29").text
    assert "Intrare: Ana Pop" in page
    assert "Ieșire: Ana Pop" not in page


def test_invalid_dates_show_error_not_crash(harness):
    r = harness.admin_client().get("/admin/jurnal?from=nu-e-data")
    assert r.status_code == 400
    assert "Dată invalidă" in r.text


def test_reversed_interval_is_rejected(harness):
    r = harness.admin_client().get("/admin/jurnal?from=2026-01-06&to=2026-01-05")
    assert r.status_code == 400


def test_pagination_caps_rows(harness):
    admin = harness.admin_client()
    for i in range(60):
        harness.create_employee(f"Persoana {i:02d}")
    page1 = admin.get("/admin/jurnal").text
    assert len(_rows(page1)) == 50
    assert "page=2" in page1
    page2 = admin.get("/admin/jurnal?page=2").text
    assert 0 < len(_rows(page2)) <= 50
    assert "page=1" in page2
    # filtrele se păstrează în linkuri
    f = admin.get("/admin/jurnal?from=2026-01-01&page=1").text
    assert "from=2026-01-01" in f and "page=2" in f


def _write(harness, **kw):
    """Simulează tichetele viitoare (#6/#8/#9) care scriu în Jurnal cu `detail` bogat."""
    from gym_control import journal
    app = harness.admin_client().app
    journal.write(app.state.db, harness.clock(), **kw)
    app.state.db.commit()


def test_anomalies_and_methods_in_detail_are_rendered(harness):
    emp = harness.create_employee("Ana Pop")
    _write(harness, kind="entry", action="entry", summary="Intrare: Ana Pop", employee_id=emp,
           detail={"method": "qr_totp", "anomalies": ["Sesiune deschisă veche", {"label": "În afara programului"}]})
    _write(harness, kind="exit", action="exit", summary="Ieșire: Ana Pop", employee_id=emp,
           detail={"method": "manual"})
    _write(harness, kind="entry", action="entry", summary="Intrare veche: Ana Pop", employee_id=emp)
    page = harness.admin_client().get("/admin/jurnal").text
    rows = _rows(page)
    r1 = next(r for r in rows if "Intrare: Ana Pop" in r)
    assert "Cod QR" in r1 and "Sesiune deschisă veche" in r1 and "În afara programului" in r1
    r2 = next(r for r in rows if "Ieșire: Ana Pop" in r)
    assert "Introdus manual" in r2
    r3 = next(r for r in rows if "Intrare veche" in r)
    assert "Cod QR" not in r3 and "Fără validare" not in r3  # lipsă tolerată
