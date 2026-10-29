# Gym Control

Pontaj Intrare/Ieșire pentru Sală, cu QR TOTP. Vocabular: `GLOSSARY.md`.

## Rulare

```
docker compose up -d
```

Pagina de stare: `http://<laptop>:8000/status`. Serviciul repornește singur
(`restart: unless-stopped`). Subrețeaua Sălii: variabila `GYM_HALL_SUBNET`.

## Primul Admin

Ecranele Admin sunt la `/admin/login`. Contul se creează în unul din două moduri:

- **Bootstrap din mediu**: setează `GYM_ADMIN_USER` și `GYM_ADMIN_PASSWORD`
  (de ex. într-un `.env` lângă `docker-compose.yml`); la pornire contul este creat
  dacă nu există. Apoi poți scoate parola din `.env`.
- **CLI** (pentru conturi suplimentare, 1–3 în total):
  `docker compose exec app python -m gym_control.cli create-admin <cont>`
  (cere parola; minimum 8 caractere).

Parolele sunt păstrate cu hash Argon2. Sesiunea Adminului ține 12 ore.

## Import Angajați (CSV)

Ecranul Angajați acceptă un CSV cu antetul `nume,email` (și `;` ca separator).
Rândurile valide se importă; cele invalide sunt listate cu numărul rândului.
Fiecare acțiune a Adminului apare în ecranul Jurnal, cu autorul.

## Teste

```
uv sync
uv run pytest
```

Testele apelează aplicația doar prin HTTP (seam-ul din `tests/conftest.py`),
cu SQLite în memorie. Ceasul, IP-ul sursă și configurația se controlează din
fixture-uri: `harness.clock.advance(...)`, `harness.client(ip)`,
`make_harness(**setări)`. Fără `sleep`.
`harness.admin_client()` întoarce un client deja autentificat ca Admin
(contul de bootstrap din `tests/conftest.py`).

## Înrolarea dispozitivului

În ecranul Angajați, Adminul apasă „Generează link” și îi trimite Angajatului linkul
(`/enroll/<token>`, valabil 48 de ore, o singură folosire). Angajatul îl deschide pe telefonul
personal și confirmă; telefonul primește un cookie de lungă durată. Un singur telefon este activ:
re-înrolarea sau „Revocă” invalidează telefonul vechi. Fără înrolare, `/me` afișează
mesajul că trebuie să te înrolezi. În teste: `harness.enrolled_client("Ana Pop")`.

## Intrare/Ieșire (pas intermediar)

Angajatul înrolat deschide `/me`: vede starea („în Sală din 10:12” / „în afara Sălii”) și doar butonul valid.
Orele se stochează în UTC și se afișează în `GYM_TIMEZONE` (implicit `Europe/Bucharest`). Încă fără QR/validare de rețea.

## Kiosk la ușă (QR TOTP)

Pe telefonul de la ușă deschide o singură dată `http://<laptop>:8000/door?k=<GYM_KIOSK_TOKEN>`; tokenul se
păstrează în cookie, iar `/door` afișează un QR care se reînnoiește singur la 30 s (SVG generat pe server, fără CDN).
Fără token valid `/door` este refuzat (și rămâne refuzat dacă `GYM_KIOSK_TOKEN` nu e setat).

- `GYM_KIOSK_TOKEN`: tokenul kiosk (secret lung, ales de Admin).
- `GYM_TOTP_SECRET`: secretul TOTP; dacă lipsește, se generează o dată și se păstrează în baza de date.

QR-ul codifică `/me?t=<TOTP>`. Intrarea/Ieșirea (`POST /me/entry|exit`) cer câmpul `totp`, validat pe ceasul
serverului (fereastra curentă și cea anterioară, 30 s); nu e de unică folosință, iar orice timestamp trimis de client
e ignorat. Metoda de validare `qr_totp` apare în Sesiune și în Jurnal. În teste: `harness.current_totp()`,
`harness.kiosk_client()`.

## `tick` și schedulerul

`scheduler.tick(app, now)` este punctul unic de intrare pentru joburile periodice. Producția pornește o buclă de
fundal (lifespan) care apelează `tick(clock())` la fiecare 60 s (`GYM_SCHEDULER=0` o oprește,
`GYM_SCHEDULER_INTERVAL` schimbă intervalul); o excepție dintr-un job este logată și bucla continuă.
Testele nu pornesc bucla (`Settings.scheduler_enabled=False`) și apelează `harness.tick()` după ce mută ceasul.

Joburile stau în registrul `scheduler.JOBS`, fiecare `def job(app, now)`, idempotent, cu commit propriu.
Primul job: la/după ora de închidere (setare la runtime, ora locală), fiecare Sesiune deschisă din ziua locală
curentă (Intrare înainte de închidere) și fiecare Sesiune veche deja marcată „Ieșire lipsă” primește Anomalia
`open_at_closing`, plus o linie în Jurnal. Sesiunea rămâne deschisă, fără Ieșire inventată; rulările repetate nu dublează.

## Incidente și retenție

Ecranul Incidente (`/admin/incidents`): Adminul marchează un interval (ora locală, notă opțională) și îl închide
mai târziu; ambele acțiuni apar în Jurnal cu autorul. Jobul de retenție (`retention.purge_job`, rulat de `tick`)
șterge Sesiunile (cu Anomaliile lor) și rândurile din Jurnal (de orice fel) mai vechi de perioada de retenție
(Setări, implicit 12 luni; `GYM_RETENTION_MONTHS` ca valoare inițială). Nu se șterg Angajații și conturile Admin.
Datele care se suprapun cu un Incident deschis rămân; după închiderea lui reintră în retenția normală.
O Sesiune care traversează limita rămâne, cu rândurile de Jurnal ale Intrării/Ieșirii ei. O rulare care a șters ceva
lasă o linie fără autor în Jurnal („Retenție: șterse …”).
