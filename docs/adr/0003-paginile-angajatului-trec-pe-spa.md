# Paginile Angajatului și Ecranul de la ușă trec și ele pe SPA-ul TypeScript

Înlocuiește ADR-0002 în partea despre paginile Angajatului și ale kioskului. Pentru o interfață unitară și modernă, pe înțelesul unor utilizatori netehnici, `/me`, `/enroll/{token}`, `/door` și `/status` se rescriu în React + TypeScript, cu același sistem de design ca Adminul; șabloanele Jinja și `static/app.css` se șterg. În `frontend/` sunt două puncte de intrare (Admin; Angajat + Ecranul de la ușă) care împart componentele, ca telefonul Angajatului să nu descarce codul Adminului. Toată validarea rămâne pe server (rețeaua Sălii, codul QR, telefonul activat); paginile devin endpointuri JSON.

## Considered Options

- **Jinja cu CSS nou (ADR-0002):** mai puțin risc pe ecranele critice, dar două sisteme vizuale întreținute în paralel, iar CSS-ul scris de mână rămâne în urma SPA-ului.

## Consequences

Testele pentru `/me`, `/enroll`, `/door` și `/status` se rescriu (HTML → JSON + teste de componentă). Telefonul vechi de la ușă trebuie să aibă un browser compatibil cu ținta de build Vite (implicit Chrome 107+); se verifică pe dispozitiv înainte de unire, altfel se coboară ținta.
