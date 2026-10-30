"""PROTOTIP: populează baza de test cu Angajați, Angajați în Sală, o Anomalie, un Incident și activează Ecranul de la ușă."""
import json, sqlite3, sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, parse_qs
import httpx

B = "http://127.0.0.1:8000"
H = {"Origin": B}
admin = httpx.Client(base_url=B, headers=H)
admin.post("/api/admin/login", json={"username": "admin", "password": "parola-de-test"}).raise_for_status()

# Ecranul de la ușă
link = admin.post("/api/admin/door-screen/activation-link").json()["link"]
token = urlparse(link).path.rsplit("/", 1)[-1]
door = httpx.Client(base_url=B, headers=H)
door.post(f"/api/employee/door/activate/{token}").raise_for_status()
door_cookies = dict(door.cookies)

names = ["Andrei Popescu", "Maria Ionescu", "Ioana Dumitru", "Mihai Stan", "Elena Georgescu", "Radu Constantin", "Ana Marin"]
ids = []
for n in names:
    e = admin.post("/api/admin/employees", json={"name": n, "email": n.lower().replace(" ", ".") + "@firma.ro"}).json()
    ids.append(e["id"])

def totp():
    url = door.get("/api/employee/door/qr").json()["url"]
    return parse_qs(urlparse(url).query)["t"][0]

for eid in ids[:4]:
    tok = urlparse(admin.post(f"/api/admin/employees/{eid}/enroll-link").json()["link"]).path.rsplit("/", 1)[-1]
    phone = httpx.Client(base_url=B, headers=H)
    phone.post(f"/api/employee/enroll/{tok}").raise_for_status()
    r = phone.post("/api/employee/entry", json={"totp": totp()})
    print("entry", eid, r.status_code)

now = datetime.now(timezone.utc)
local = datetime.now()  # Incidentul se dă în ora Sălii, ca „AAAA-LL-ZZTHH:MM”
admin.post("/api/admin/incidents", json={"start": (local - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M"), "end": (local - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M"), "note": "Gantera spartă la rastel"}).raise_for_status()

db = sqlite3.connect(sys.argv[1])
for sid in [r[0] for r in db.execute("SELECT id FROM sessions ORDER BY id LIMIT 3")]:
    db.execute("INSERT OR IGNORE INTO session_anomalies (session_id, code, at) VALUES (?,?,?)", (sid, "outside_hours", now.isoformat()))
db.commit()
print("anomalies", len(admin.get("/api/admin/anomalies").json()), "in hall", len(admin.get("/api/admin/in-hall").json()["people"]))
json.dump({"door": door_cookies, "admin": dict(admin.cookies)}, open(sys.argv[2], "w"))
