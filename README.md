# Gym Control

Pontaj Intrare/Ieșire pentru Sală, cu QR TOTP. Vocabular: `GLOSSARY.md`.

## Rulare

```
docker compose up -d
```

Pagina de stare: `http://<laptop>:8000/status`. Serviciul repornește singur
(`restart: unless-stopped`). Subrețeaua Sălii: variabila `GYM_HALL_SUBNET`.

## Primul Admin

Ecranele Admin sunt la `/admin/` (login la `/admin/login`). Contul se creează în unul din două moduri:

- **Bootstrap din mediu**: setează `GYM_ADMIN_USER` și `GYM_ADMIN_PASSWORD`
  (de ex. într-un `.env` lângă `docker-compose.yml`); la pornire contul este creat
  dacă nu există. Apoi poți scoate parola din `.env`.
- **CLI** (pentru conturi suplimentare, 1–3 în total):
  `docker compose exec app python -m gym_control.cli create-admin <cont>`
  (cere parola; minimum 8 caractere).

Parolele sunt păstrate cu hash Argon2. Sesiunea Adminului ține 12 ore.

Protecții pe ecranele Admin:
- **Limitarea încercărilor de login**: 5 eșecuri în 15 minute pentru aceeași pereche (IP, cont) blochează 15 minute
  loginul (mesaj „Prea multe încercări eșuate…”, HTTP 429). Starea e în memorie (se resetează la repornire).
- **CSRF**: orice POST pe `/admin/...` și `/api/admin/...` cere `Origin` (sau `Referer`) identic cu originea aplicației; altfel 403.
  Fără tokeni în formulare. Cookie-ul Adminului este și `SameSite=Lax`. În teste, clienții trimit `Origin: http://testserver`.

## Interfața Admin (SPA, `frontend/`)

Ecranele Admin migrează într-un SPA React + Vite + TypeScript (ADR 0002), servit la `/admin/` și
construit în Dockerfile (multi-stage; imaginea finală nu are Node). Ecranele nemigrate rămân HTML pe server.
Login/logout/identitate sunt JSON: `POST /api/admin/login` (`{username, password}`), `POST /api/admin/logout`,
`GET /api/admin/me`; fără sesiune răspunsul este 401.

```
cd frontend
npm ci
npm run dev          # Vite pe :5173/admin/, proxy /api către uvicorn pe :8000
npm test             # Vitest + MSW (ecrane întregi, API simulat la granița HTTP)
npm run typecheck
npm run gen:api      # regenerează openapi.json + src/api/schema.d.ts din aplicația Python
npm run check:api    # pică dacă tipurile generate nu sunt la zi (rulează și în CI)
```

Dezvoltare: pornește aplicația (`GYM_SCHEDULER=0 uv run uvicorn gym_control.app:app_from_env --factory`)
și apoi `npm run dev`. Aplicația servește `frontend/dist` doar dacă `GYM_FRONTEND_DIST` indică un build.
Ecran nou: endpoint-uri JSON cu modele Pydantic în `src/gym_control/admin_api.py` (sau modul nou cu prefix
`/api/admin`), `npm run gen:api`, ecranul în `frontend/src/screens/` (înregistrat în `SCREENS` din `Shell.tsx` și
în `App.tsx`), teste Vitest cu MSW și teste backend pe JSON; apoi se șterg ruta Jinja, șablonul și testele HTML vechi.

## Angajați (SPA)

Ecranul Angajați (`/admin/employees`) este în SPA: listă, adăugare din dialog, link de înrolare (copiere dintr-un click),
revocare cu confirmare. API: `GET/POST /api/admin/employees` (eroare de validare: 400 `{detail, field}`),
`POST /api/admin/employees/{id}/enroll-link`, `POST /api/admin/employees/{id}/revoke` (204).
Fiecare acțiune a Adminului apare în ecranul Jurnal, cu autorul.

## Raport de prezență (SPA)

Ecranul Rapoarte (`/admin/reports`) generează Raportul pe un interval orar; varianta tipărită e ruta SPA
`/admin/reports/print?from=..&to=..` (fără navigare laterală, `print:` ascunde butoanele). API (`report_api.py`):
`GET /api/admin/reports?from=..&to=..` (rânduri, textul de neacceptare și textul „deschisă”, trimise de server;
interval invalid: 400 `{detail}`) și `GET /api/admin/reports.csv?from=..&to=..` (descărcare, același CSV).
Generarea (și afișarea tipărită) și exportul intră în Jurnal cu autorul.

## Import Angajați (CSV)

Încă nu are ecran în SPA (tichetul #19); ruta HTML veche a fost ștearsă odată cu ecranul Angajați.
Parsarea (`employees.parse_csv`, `ImportResult`) rămâne în `employees.py`. Formatul: antetul `nume,email`
(și `;` ca separator); rândurile valide se importă, cele invalide sunt listate cu numărul rândului.

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

### Anomalii (decizii)

- **Ieșire pe o Sesiune veche** (deschisă într-o zi locală anterioară): nu se închide cu ora curentă (ar inventa
  o prezență peste noapte în Raport). Sesiunea e marcată `missing_exit`, Ieșirea e respinsă cu mesajul
  „Nu ai o Intrare deschisă azi… Adminul poate corecta Sesiunea”, iar o Intrare nouă rămâne posibilă. Adminul o
  corectează din ecranul Anomalii.
- `open_at_closing` se rezolvă singură când o Ieșire normală închide Sesiunea (sau prin corectarea Adminului).
- `outside_hours` e o marcă istorică a Intrării: rămâne în Raport și în Jurnal, dar Adminul o poate marca
  „verificată” în ecranul Anomalii (rând în Jurnal cu autorul), ca să nu aglomereze lista de acțiuni.

## Incidente și retenție

Ecranul Incidente (`/admin/incidents`): Adminul marchează un interval (ora locală, notă opțională) și îl închide
mai târziu; ambele acțiuni apar în Jurnal cu autorul. Jobul de retenție (`retention.purge_job`, rulat de `tick`)
șterge Sesiunile (cu Anomaliile lor) și rândurile din Jurnal (de orice fel) mai vechi de perioada de retenție
(Setări, implicit 12 luni; `GYM_RETENTION_MONTHS` ca valoare inițială). Nu se șterg Angajații și conturile Admin.
Datele care se suprapun cu un Incident deschis rămân; după închiderea lui reintră în retenția normală.
O Sesiune care traversează limita rămâne, cu rândurile de Jurnal ale Intrării/Ieșirii ei. O rulare care a șters ceva
lasă o linie fără autor în Jurnal („Retenție: șterse …”).
## Instalare (rezumat)

1. Pe laptop: Docker + Docker Compose. Clonează depozitul.
2. Creează un `.env` lângă `docker-compose.yml`:

   | Variabilă | Rol |
   | --- | --- |
   | `GYM_ADMIN_USER`, `GYM_ADMIN_PASSWORD` | primul Admin (vezi „Primul Admin”) |
   | `GYM_KIOSK_TOKEN` | tokenul telefonului de la ușă (secret lung; fără el `/door` e refuzat) |
   | `GYM_TOTP_SECRET` | secretul TOTP (opțional; altfel generat o dată și păstrat în baza de date) |
   | `GYM_HALL_SUBNET` | subrețeaua Wi-Fi a Sălii (implicit `192.168.10.0/24`) |
   | `GYM_BACKUP_PATH` | directorul de pe gazdă unde se scriu backup-urile (vezi „Backup”) |
   | `GYM_BACKUP_KEEP_DAYS` | zile de păstrare a backup-urilor (implicit 30) |

   Fusul orar, programul și retenția se pot seta și cu `GYM_TIMEZONE`, `GYM_OPENING_TIME`,
   `GYM_CLOSING_TIME`, `GYM_RETENTION_MONTHS`.
3. `docker compose up -d`, apoi verifică `http://<laptop>:8000/status`.

Baza de date stă în volumul Docker `gym_data` (`/data/gym_control.db`).

## Backup

Zilnic, prin `tick`, aplicația face o copie consistentă a bazei (API-ul de backup SQLite, nu copiere
brută) în `gym-control-AAAA-LL-ZZ.sqlite` (zi locală), cel mult un fișier pe zi. Apoi șterge
backup-urile mai vechi de 30 de zile (doar fișierele cu acest nume; alte fișiere din director rămân).
O eroare de backup este logată (`docker compose logs app`) și nu oprește celelalte joburi.

- Locația: `GYM_BACKUP_PATH` pe gazdă este montat în container ca `/backup` (`GYM_BACKUP_DIR` în aplicație).
  Alege o locație **separată de laptop**: un share de rețea montat pe gazdă (de ex. `/mnt/nas/sala`) sau un
  stick USB montat permanent. Implicit `./backups` (pe același laptop, doar pentru probă).
- Fișierele de backup conțin secretul TOTP și hash-urile parolelor Adminilor: aplicația le creează cu permisiuni
  `0600` și directorul (dacă îl creează ea) cu `0700`. Un director deja existent (share, USB) își păstrează
  permisiunile: restricționează-le tu. Fișierele din rotație cu nume-dată invalidă sunt ignorate.
- Fără `GYM_BACKUP_DIR` setat (rulare fără compose) backup-ul este oprit.
- Verifică periodic că fișierele apar și că locația nu s-a demontat.

## Restaurare din backup

1. Oprește aplicația: `docker compose down` (nu șterge volumele).
2. Alege fișierul dorit din `GYM_BACKUP_PATH`, de ex. `gym-control-2026-01-05.sqlite`.
3. Copiază-l peste baza din volum (și scoate fișierele WAL vechi, dacă există):
   ```
   docker compose run --rm --no-deps -v "$PWD/restore:/restore" --entrypoint sh app -c \
     'rm -f /data/gym_control.db-wal /data/gym_control.db-shm && cp /restore/gym-control-2026-01-05.sqlite /data/gym_control.db'
   ```
   (pune întâi fișierul ales în `./restore/`).
4. Pornește: `docker compose up -d`; verifică `/status` și ecranele Admin (Angajați, Jurnal).
5. Datele de după momentul backup-ului se pierd; Angajații înrolați după el trebuie re-înrolați.

## Rețea, proxy și cookie-uri

- Validarea de rețea folosește doar adresa conexiunii TCP (ADR 0001: LAN, expunere directă, fără proxy).
  **Nu pune un reverse proxy în fața aplicației**: toate cererile ar părea să vină de la IP-ul proxy-ului și
  validarea IP (Intrare/Ieșire/înrolare doar din subrețeaua Sălii) ar fi ocolită sau ar refuza pe toată lumea.
- Dacă totuși ai nevoie de proxy, setează `GYM_TRUSTED_PROXIES` (IP-uri sau subrețele, separate prin virgulă):
  `X-Forwarded-For` e luat în calcul doar când conexiunea vine de la un proxy din listă, iar proxy-ul trebuie
  să adauge (nu să păstreze) adresa clientului real. Implicit lista e goală.
- Cookie-urile (Admin, dispozitiv, kiosk) **nu au flagul `Secure`**: aplicația rulează în HTTP simplu în LAN, iar
  un cookie `Secure` nu ar fi trimis deloc. Nu o expune pe internet.

## Setup fizic

### Telefonul-kiosk (ușa)
- Folosește un telefon vechi **fără baterie umflată**; o baterie umflată este un risc de incendiu, nu-l lăsa la încărcat permanent.
- Încărcător permanent, cablu bun; Setări > Opțiuni dezvoltator > **Stay awake** (ecran aprins la încărcare).
- Luminozitate fixă (auto-brightness oprit), notificările oprite, blocarea ecranului dezactivată.
- Browser în mod kiosk / ecran complet (de ex. Chrome „Adaugă pe ecranul principal” sau o aplicație de kiosk).
- O singură dată, deschide `http://<laptop>:8000/door?k=<GYM_KIOSK_TOKEN>`; tokenul se păstrează în cookie
  și apoi poți folosi `http://<laptop>:8000/door`. Telefonul trebuie să fie pe Wi-Fi-ul Sălii.

### Laptopul
- Dezactivează suspendarea la închiderea capacului (ex. `HandleLidSwitch=ignore` în `/etc/systemd/logind.conf`) și suspendarea automată.
- IP static: rezervare DHCP în router (după MAC) sau un hostname local stabil; telefoanele folosesc această adresă.
- Pornire automată după pană de curent: setarea BIOS „AC power loss / Restore on AC” = Power On; Docker pornit la boot
  (`systemctl enable docker`); serviciul are `restart: unless-stopped`.
- Opțional, un UPS mic pentru întreruperi scurte.

## Verificări manuale (neacoperite de teste automate)

- Randare responsivă: deschide `/me` și ecranele Admin pe un telefon real și verifică lizibilitatea.
- Pagina kiosk în browser real: `/door` afișează QR-ul, se reînnoiește la 30 s, ecranul rămâne aprins; scanează-l cu un telefon înrolat.
- Docker: `docker compose up -d` pe laptop curat; repornește laptopul și verifică că serviciul revine; oprește containerul și vezi că repornește.
- Backup: după prima zi, există `gym-control-*.sqlite` în `GYM_BACKUP_PATH`; încearcă o restaurare pe o copie de probă.
