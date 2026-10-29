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
