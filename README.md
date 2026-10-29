# GymCtrl

Aplicația înregistrează Intrările și Ieșirile Angajaților din Sală, cu cod QR TOTP, și îi dă Adminului pagina de
gestiune, Jurnalul și Raportul de prezență. Vocabular: `GLOSSARY.md`.

Un singur proiect frontend (React + TypeScript, un singur sistem de design) cu **două puncte de intrare**,
ambele servite de aplicația Python (ADR 0002, 0003):

| Punct de intrare | Adrese publice | Pentru cine |
| --- | --- | --- |
| **Admin** (`frontend/index.html`) | `/admin/*` (login la `/admin/login`) | Adminul, pe laptop sau pe telefon |
| **Angajat** (`frontend/employee.html`) | `/me`, `/enroll/{token}` (Activare telefon), `/door` (Ecranul de la ușă), `/status` (Verificare conexiune) | Angajatul, pe telefonul lui; telefonul de la ușă |

Punctul de intrare Angajat nu importă cod Admin (verificat la build); cele două împart doar sistemul de design.
API-ul este JSON sub `/api/admin/...` și `/api/employee/...`; paginile nu sunt randate pe server.

## Rulare

```
docker compose up -d
```

Pornește aplicația cu ambele puncte de intrare (imaginea se construiește în două etape: build-ul frontend-ului cu Node,
apoi imaginea finală doar cu Python). Pagina de stare: `http://<laptop>:8000/status`. Serviciul repornește singur
(`restart: unless-stopped`). Subrețeaua Sălii: variabila `GYM_HALL_SUBNET`.

## Primul Admin

Ecranele Admin sunt la `/admin/` (login la `/admin/login`; `POST /api/admin/login`, `/logout`, `GET /api/admin/me`; butonul „Deconectare” din meniu). Contul se creează în unul din două moduri:

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

## Interfața (SPA, `frontend/`)

Toate ecranele sunt React 19 + Vite + TypeScript strict (ADR 0002, 0003), construite în Dockerfile (multi-stage;
imaginea finală are doar Python, fără Node). Structura `frontend/src/`: `design/` (sistemul de design comun), `screens/` și
`components/` (Admin), `employee/` (Angajat), `api/` (client și tipuri generate din OpenAPI). Telefonul de la ușă e vechi: build-ul Vite țintește Chrome 64 / Safari 11 (vezi ADR 0003, „Ținta de build”).
Aplicația servește `frontend/dist` (cu fallback la `index.html`) doar dacă `GYM_FRONTEND_DIST` indică un build;
în imaginea Docker este setat deja.

Ecrane Admin: pagina de gestiune (Acasă), Angajați (adăugare, Activare telefon, scoatere din uz cu confirmare, import din Excel/CSV), Jurnal (filtre în adresă:
`?employee=&from=&to=&kind=&page=`), Anomalii, Incidente, Raport de prezență (ecran, CSV, variantă tipărită la
`/admin/reports/print`), Setări (inclusiv Perioada de păstrare), plus dialogurile Sesiune manuală (adăugare, corectare). Fiecare acțiune a Adminului
intră în Jurnal cu autorul.

API-ul este JSON sub `/api/admin/...`, cu modele Pydantic de răspuns (în `admin_api.py`, `admin_settings_api.py`,
`journal_api.py`, `report_api.py`, `manual_sessions.py`). Fără sesiune răspunsul este 401, iar SPA-ul duce la login.
Erorile de validare sunt 400 `{detail, field}` (mesajele în română vin de la server). Schema este documentată de
FastAPI la `/docs`.

### Dezvoltare

Node 22+ și npm sunt necesare doar pentru frontend. **Sub WSL folosește Node 22+ de Linux** (instalat în WSL, de ex. cu
nvm); `npm` din Windows, văzut prin `/mnt/c/...`, nu merge. Cu două terminale:

```
GYM_SCHEDULER=0 GYM_ADMIN_USER=admin GYM_ADMIN_PASSWORD=parola-de-test uv run uvicorn gym_control.app:app_from_env --factory
cd frontend && npm ci && npm run dev
```

Deschide `http://localhost:5173/admin/`: serverul Vite face proxy pentru `/api` către uvicorn pe `:8000`
(browserul vede o singură origine, deci verificarea `Origin` a POST-urilor trece).

Paginile Angajatului (`/me`, `/enroll/<token>`, `/door`, `/status`) sunt servite de Python din build, nu de Vite: rulează
`npm run build` și pornește uvicorn cu `GYM_FRONTEND_DIST=frontend/dist`, apoi deschide `http://localhost:8000/me` etc.
(validarea de rețea cere IP-ul sursă din `GYM_HALL_SUBNET`; local setează-l, de ex. `GYM_HALL_SUBNET=127.0.0.0/8`).

### Build și verificări

Rulează din `frontend/`:

```
npm test             # Vitest + MSW: ecrane întregi, API simulat la granița HTTP
npm run typecheck    # tsc strict
npm run build        # tsc + vite build -> frontend/dist
npm run gen:api      # regenerează openapi.json + src/api/schema.d.ts din aplicația Python
npm run check:api    # pică dacă openapi.json / tipurile generate nu sunt la zi
```

Tipurile TS sunt generate din schema OpenAPI a aplicației (`scripts/export_openapi.py`); după orice schimbare de
câmp în API rulează `npm run gen:api` și comite rezultatul. CI (`.github/workflows/ci.yml`) rulează `uv run pytest`
și, în `frontend/`, `npm ci`, `check:api`, `typecheck`, `test`, `build`.

Ecran nou: endpoint-uri JSON cu modele Pydantic, `npm run gen:api`, ecranul în `frontend/src/screens/`
(înregistrat în `SCREENS` din `Shell.tsx` și în `App.tsx`), teste Vitest cu MSW și teste backend pe JSON.

### Import listă din Excel (CSV)

`POST /api/admin/employees/import` (`multipart`, câmpul `file`) întoarce `{created, errors}`. Antetul `nume,email`
(separator `,` sau `;`, BOM acceptat); rândurile valide se importă, cele invalide apar ca `"Rândul N: ..."`; un antet
greșit dă 400 `{detail}`. Parsarea este în `employees.parse_csv`.

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

## Activarea telefonului

În ecranul Angajați, Adminul face Activarea telefonului: Angajatul scanează codul QR sau primește linkul
(`/enroll/<token>`, valabil 48 de ore, o singură folosire). Îl deschide pe telefonul
personal și apasă „Activează acest telefon”; telefonul primește un cookie de lungă durată. Un singur telefon este activ:
o nouă Activare sau scoaterea din uz invalidează telefonul vechi. Fără Activare, `/me` afișează
o pagină care spune să ceri Adminului un link. În teste: `harness.enrolled_client("Ana Pop")`.

## Intrare/Ieșire

Angajatul cu telefon activat scanează codul de la ușă (se deschide `/me?t=...`): vede un buton rotund mare, Intrare sau Ieșire, după starea lui. Fiecare eroare are propriul ecran.
Orele se stochează în UTC și se afișează în `GYM_TIMEZONE` (implicit `Europe/Bucharest`).

## Ecranul de la ușă (QR TOTP)

Ecranul de la ușă se activează din aplicație (ADR 0004), fără variabile de mediu: în meniul „Ecranul de la ușă” Adminul
vede starea (neactivat / activ din data X) și apasă „Activează”. Aplicația emite un link cu QR, de unică folosință,
valabil 48 de ore (`/door/activate/<token>`). Pe telefonul de la ușă linkul arată „Activezi acest telefon ca Ecran de la
ușă?” și nu se consumă până la apăsarea butonului; apoi telefonul trece la `/door`, care afișează un QR mare, negru pe alb,
cu un inel-cronometru (SVG generat pe server, fără CDN; codul vine din `GET /api/employee/door/qr`, doar pentru telefonul
activat). Activarea cere rețeaua Sălii și intră în Jurnal cu autorul; o nouă Activare scoate din uz telefonul anterior, iar
starea stă în baza de date (rămâne după repornire). Un telefon neactivat primește o pagină explicativă. Dacă reîmprospătarea
eșuează mai mult de 30 s, inelul se oprește și apare „Codul nu se mai actualizează. Verifică Wi-Fi-ul telefonului.”

- `GYM_TOTP_SECRET`: secretul TOTP; dacă lipsește, se generează o dată și se păstrează în baza de date.

QR-ul codifică `/me?t=<TOTP>`. Intrarea/Ieșirea (`POST /api/employee/entry|exit`, JSON) cer câmpul `totp`, validat pe ceasul
serverului (fereastra curentă și cea anterioară, 30 s); nu e de unică folosință, iar orice timestamp trimis de client
e ignorat. Metoda de validare `qr_totp` apare în Sesiune și în Jurnal. În teste: `harness.current_totp()`,
`harness.door_client()`.

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

## Incidente și Perioada de păstrare

Ecranul Incidente (SPA la `/admin/incidents`, API `/api/admin/incidents`): Adminul marchează un interval (ora locală, notă opțională) și îl închide
mai târziu; ambele acțiuni apar în Jurnal cu autorul. Jobul de păstrare a datelor (`retention.purge_job`, rulat de `tick`)
șterge Sesiunile (cu Anomaliile lor) și rândurile din Jurnal (de orice fel) mai vechi de Perioada de păstrare
(Setări, implicit 12 luni; `GYM_RETENTION_MONTHS` ca valoare inițială). Nu se șterg Angajații și conturile Admin.
Datele care se suprapun cu un Incident deschis rămân; după închiderea lui reintră sub Perioada de păstrare.
O Sesiune care traversează limita rămâne, cu rândurile de Jurnal ale Intrării/Ieșirii ei. O rulare care a șters ceva
lasă o linie fără autor în Jurnal („Păstrarea datelor: șterse …”).
## Instalare (rezumat)

1. Pe laptop: Docker + Docker Compose. Clonează depozitul.
2. Creează un `.env` lângă `docker-compose.yml`:

   | Variabilă | Rol |
   | --- | --- |
   | `GYM_ADMIN_USER`, `GYM_ADMIN_PASSWORD` | primul Admin (vezi „Primul Admin”) |
   | `GYM_TOTP_SECRET` | secretul TOTP (opțional; altfel generat o dată și păstrat în baza de date) |
   | `GYM_HALL_SUBNET` | subrețeaua Wi-Fi a Sălii (implicit `192.168.10.0/24`) |
   | `GYM_BACKUP_PATH` | directorul de pe gazdă unde se scriu backup-urile (vezi „Backup”) |
   | `GYM_BACKUP_KEEP_DAYS` | zile de păstrare a backup-urilor (implicit 30) |

   Fusul orar, programul și Perioada de păstrare se pot seta și cu `GYM_TIMEZONE`, `GYM_OPENING_TIME`,
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
5. Datele de după momentul backup-ului se pierd; Telefoanele activate după el trebuie activate din nou.

## Rețea, proxy și cookie-uri

- Validarea de rețea folosește doar adresa conexiunii TCP (ADR 0001: LAN, expunere directă, fără proxy).
  **Nu pune un reverse proxy în fața aplicației**: toate cererile ar părea să vină de la IP-ul proxy-ului și
  validarea IP (Intrare/Ieșire/înrolare doar din subrețeaua Sălii) ar fi ocolită sau ar refuza pe toată lumea.
- Dacă totuși ai nevoie de proxy, setează `GYM_TRUSTED_PROXIES` (IP-uri sau subrețele, separate prin virgulă):
  `X-Forwarded-For` e luat în calcul doar când conexiunea vine de la un proxy din listă, iar proxy-ul trebuie
  să adauge (nu să păstreze) adresa clientului real. Implicit lista e goală.
- Cookie-urile (Admin, dispozitiv, Ecranul de la ușă) **nu au flagul `Secure`**: aplicația rulează în HTTP simplu în LAN, iar
  un cookie `Secure` nu ar fi trimis deloc. Nu o expune pe internet.

## Setup fizic

### Ecranul de la ușă (telefonul fix)
- Folosește un telefon vechi **fără baterie umflată**; o baterie umflată este un risc de incendiu, nu-l lăsa la încărcat permanent.
- Încărcător permanent, cablu bun; Setări > Opțiuni dezvoltator > **Stay awake** (ecran aprins la încărcare).
- Luminozitate fixă (auto-brightness oprit), notificările oprite, blocarea ecranului dezactivată.
- Browser în ecran complet (de ex. Chrome „Adaugă pe ecranul principal” sau o aplicație de ecran dedicat).
- Activează-l din aplicație (Admin > „Ecranul de la ușă” > „Activează”): scanează QR-ul de pe laptop cu telefonul de la
  ușă și apasă butonul de confirmare. Telefonul trebuie să fie pe Wi-Fi-ul Sălii.

### Laptopul
- Dezactivează suspendarea la închiderea capacului (ex. `HandleLidSwitch=ignore` în `/etc/systemd/logind.conf`) și suspendarea automată.
- IP static: rezervare DHCP în router (după MAC) sau un hostname local stabil; telefoanele folosesc această adresă.
- Pornire automată după pană de curent: setarea BIOS „AC power loss / Restore on AC” = Power On; Docker pornit la boot
  (`systemctl enable docker`); serviciul are `restart: unless-stopped`.
- Opțional, un UPS mic pentru întreruperi scurte.

## Verificări manuale (neacoperite de teste automate)

- Randare responsivă: deschide `/me` și `/admin/` pe un telefon real și verifică lizibilitatea, temele luminoasă/întunecată
  și instalarea pe ecranul telefonului.
- **Ecranul de la ușă pe telefonul real de la ușă** (browserul lui e vechi; ADR 0003, „Ținta de build”): `/door` afișează QR-ul și inelul, se reînnoiește la 30 s, ecranul rămâne aprins; scanează-l cu un telefon activat. Oprește Wi-Fi-ul telefonului ~40 s și verifică avertismentul, apoi repornește-l. Dacă pagina rămâne albă, notează versiunea din `chrome://version` și coboară ținta de build.
- Docker: `docker compose up -d` pe laptop curat; repornește laptopul și verifică că serviciul revine; oprește containerul și vezi că repornește.
- Backup: după prima zi, există `gym-control-*.sqlite` în `GYM_BACKUP_PATH`; încearcă o restaurare pe o copie de probă.
