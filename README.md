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
