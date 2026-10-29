# Interfața Adminului este un SPA în TypeScript peste un API JSON

> Partea despre paginile Angajatului și ale kioskului e înlocuită de [ADR-0003](0003-paginile-angajatului-trec-pe-spa.md).

Ecranele Admin (`/admin/*`) se rescriu ca SPA în React + Vite + TypeScript strict (Tailwind, shadcn/ui, TanStack Query, React Router), care vorbește cu FastAPI prin `/api/admin/*` în JSON. Șabloanele Jinja ale Adminului se șterg. Paginile Angajatului și ale kioskului (`/me`, `/enroll/{token}`, `/door`, `/status`) rămân HTML randat pe server, cu restyle CSS. Modulele de domeniu din Python nu se modifică.

Autentificarea rămâne cea actuală: cookie de sesiune opac, verificarea `Origin` pe POST-uri și limitarea încercărilor de login. Fără JWT sau tokeni CSRF. Frontend-ul stă în `frontend/`; build-ul multi-stage din Dockerfile îl servește static din același container. Tipurile TS se generează din schema OpenAPI, iar o verificare în CI pică dacă nu sunt la zi.

## Considered Options

- **Păstrăm Jinja și adăugăm TypeScript doar pe pagini (HTMX/Alpine):** mai puțină muncă, dar interfața nu ar fi cu adevărat în TypeScript și aspectul modern ar depinde tot de CSS scris de mână.
- **SPA și pentru paginile Angajatului și kiosk:** risc inutil pe ecrane mici și critice (telefon, tabletă cu QR care se reîmprospătează), fără câștig pentru 1–3 Admini.
- **Frontend într-un container separat:** a doua imagine și un al doilea serviciu de operat, pentru o aplicație internă.

## Consequences

Rescriem toate rutele Admin și testele lor (HTML → JSON); testele pentru `/me`, `/door`, `/enroll`, `/status` rămân. Imaginea Docker capătă un stadiu de build cu Node, dar imaginea finală rămâne doar Python. Migrarea se face pe o ramură de integrare, un tichet per ecran, și se unește în `main` doar când toate ecranele Admin sunt gata; nu rulăm două UI-uri Admin în paralel.
