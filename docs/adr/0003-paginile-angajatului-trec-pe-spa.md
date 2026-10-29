# Paginile Angajatului și Ecranul de la ușă trec și ele pe SPA-ul TypeScript

Înlocuiește ADR-0002 în partea despre paginile Angajatului și ale kioskului. Pentru o interfață unitară și modernă, pe înțelesul unor utilizatori netehnici, `/me`, `/enroll/{token}`, `/door` și `/status` se rescriu în React + TypeScript, cu același sistem de design ca Adminul; șabloanele Jinja și `static/app.css` se șterg. În `frontend/` sunt două puncte de intrare (Admin; Angajat + Ecranul de la ușă) care împart componentele, ca telefonul Angajatului să nu descarce codul Adminului. Toată validarea rămâne pe server (rețeaua Sălii, codul QR, telefonul activat); paginile devin endpointuri JSON.

## Considered Options

- **Jinja cu CSS nou (ADR-0002):** mai puțin risc pe ecranele critice, dar două sisteme vizuale întreținute în paralel, iar CSS-ul scris de mână rămâne în urma SPA-ului.

## Consequences

Testele pentru `/me`, `/enroll`, `/door` și `/status` se rescriu (HTML → JSON + teste de componentă). Ținta implicită de build Vite (Chrome 107+) e prea nouă pentru telefonul vechi de la ușă; vezi „Ținta de build” mai jos. Se verifică pe dispozitiv înainte de unire.

## Ținta de build (Ecranul de la ușă)

Versiunea browserului de pe telefonul de la ușă nu se cunoaște, dar telefonul e vechi. În loc să o măsurăm, am coborât ținta de build Vite, conservator: `build.target = ["chrome64", "safari11", "firefox78"]` pentru tot build-ul (Vite nu are ținte pe punct de intrare, iar un al doilea build ar dubla configurația; Adminul rămâne neschimbat pe browsere moderne, doar JS-ul iese ceva mai lung).

- **De ce Chrome 64:** e cea mai joasă țintă la care cele trei lucruri de care depinde pagina există fără polyfill-uri: scripturi `type="module"` (61), `import()` dinamic (63) și animațiile CSS pe SVG. Sub Chrome 63 ar fi nevoie de `@vitejs/plugin-legacy` (pachet separat, fără module), iar asta nu merită până nu se dovedește că telefonul e atât de vechi.
- **Ce face ținta:** esbuild coboară sintaxa (`?.`, `??`, câmpuri de clasă, `catch` fără parametru etc.) și preîncarcă helperii. API-urile de rulare nu se transformă: am verificat manual în pachetul `/door` că nu rămân apeluri nesigure la încărcare (React protejează `queueMicrotask`/`AbortController`; `globalThis`, `Promise.allSettled` sau `.flat()` nu apar pe drumul `/door`).
- **Pachet separat pentru `/door`:** `employee/main.tsx` alege după cale între `doorMain` (React + ecranul, fără router, react-query, Tailwind, `motion` sau fontul Inter) și `appMain` (restul adreselor Angajatului). `react-query`, de exemplu, citește `globalThis` la încărcare și ar pica pe Chrome sub 71.
- **CSS al ecranului:** `door.css`, scris de mână, fără `gap` pe flex, `inset`, `aspect-ratio`, `min()`, `:is()`, `dvh`, `oklch`; inelul e un cerc SVG animat cu `stroke-dashoffset`. Tailwind 4 (restul ecranelor) cere un browser modern (Chrome 111+): ținta nu îl schimbă, deci doar ecranul de la ușă e garantat pe telefonul vechi.
- **Rămâne de făcut:** verificarea pe dispozitiv, înainte de unire (vezi README). Dacă pagina nu pornește, se notează versiunea din `chrome://version` și se coboară ținta (sau se adaugă `plugin-legacy` doar pentru `/door`).
