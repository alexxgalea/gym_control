# Ecranul de la ușă se activează din aplicație, nu cu un token din mediu

Înlocuiește partea din ADR-0001 despre „tokenul de kiosk". Tokenul `GYM_KIOSK_TOKEN` și linkul `/door?k=<token>` cereau o persoană tehnică de fiecare dată când se schimba telefonul de la ușă. Acum Adminul face **Activare Ecran de la ușă** din meniul „Ecranul de la ușă": primește un link de unică folosință cu QR (48 de ore), îl deschide pe telefonul de la ușă și confirmă cu un buton, ca la Activare telefon pentru Angajat.

## Considered Options

- **Token în mediu (varianta veche):** simplu, dar singura cale de a schimba telefonul trece prin `.env` și repornirea serverului.
- **Token în mediu ca rezervă, alături de activarea din aplicație:** două moduri de a face același lucru și stare ascunsă în `.env`.

## Consequences

- Un singur Ecran de la ușă activ; o nouă Activare scoate din uz telefonul anterior, iar Adminul îl poate scoate din uz și fără înlocuire.
- Activarea cere rețeaua Sălii, iar fiecare Activare și scoatere din uz intră în Jurnal cu autorul.
- `GYM_KIOSK_TOKEN` dispare; starea Ecranului de la ușă stă în baza de date.
- Siguranța din ADR-0001 rămâne: doar telefonul activat vede QR-ul de la `/door`, iar codul expiră rapid.
