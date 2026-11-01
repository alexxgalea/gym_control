# Ecranul de la ușă folosește sistemul de design comun, pe un browser modern

Înlocuiește secțiunea „Ținta de build” din ADR-0003. Telefonul de la ușă nu mai e unul vechi, ci unul nou, montat vertical. Ca Ecranul de la ușă să arate la fel de îngrijit ca restul aplicației (fundal închis animat, card QR, tranziții), renunțăm la CSS-ul scris de mână pentru un browser vechi: ecranul folosește Tailwind, fontul Inter și `motion`, iar ținta de build revine la valoarea implicită din Vite. Pachetul `/door` rămâne totuși separat (`doorMain`, fără router și fără react-query), ca pagina să pornească repede și să depindă de cât mai puțin cod.

## Considered Options

- **Păstrarea țintei Chrome 64 și a CSS-ului scris de mână:** sigur pe orice telefon, dar efectele vizuale cerute (estompare, `aspect-ratio`, animații cu `motion`) ar trebui refăcute de mână, iar ecranul ar rămâne un al doilea sistem vizual.
- **CSS modern scris de mână, fără Tailwind:** câștig vizual, dar tot un al doilea sistem de stiluri de întreținut.

## Consequences

- Dacă telefonul de la ușă e înlocuit vreodată cu unul vechi, ecranul poate să nu mai pornească; Tailwind 4 cere Chrome 111+.
- Rămâne de verificat pe dispozitiv versiunea din `chrome://version` (trebuie să fie 111 sau mai nouă) înainte de unire.
