"""Cereri concurente: lock-ul bazei de date nu trebuie să blocheze aplicația."""

from concurrent.futures import ThreadPoolExecutor


def test_many_concurrent_requests_do_not_freeze_the_app(harness):
    clients = [harness.client() for _ in range(12)]

    def hammer(c):
        return [c.get("/api/employee/status").status_code for _ in range(30)]

    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(hammer, clients, timeout=60))
    assert all(code == 200 for codes in results for code in codes)
    # aplicația răspunde în continuare (lock-ul nu a rămas blocat)
    assert harness.client().get("/api/employee/status").status_code == 200
