# Prezența se validează doar prin rețea și TOTP, fără BLE sau detecție de ușă

Intrarea și Ieșirea se validează prin QR TOTP afișat la ușă și prin IP-ul sursă din subrețeaua Wi-Fi a Sălii. Browserul unui telefon nu poate citi SSID-ul și nu poate vorbi BLE fără aplicație nativă, iar fără senzor sau yală smart aplicația nu poate observa deschiderea fizică a ușii. Funcția „deschideri de ușă fără check-in" și BLE-ul din cerințele inițiale rămân în afara v1.

## Considered Options

- **BLE beacon:** cere aplicație nativă pe telefonul Angajatului, deci pierdem varianta fără instalare.
- **Senzor de ușă sau yală smart:** hardware în plus și un model de date pentru evenimente de ușă. Se poate adăuga ulterior ca eveniment „Ușă deschisă" în Jurnal.

## Consequences

Un Angajat aflat pe Wi-Fi-ul firmei, dar în afara Sălii, ar putea face Intrare dacă primește un QR valid în 30–60 s. Riscul e redus de faptul că QR-ul se vede doar pe Ecranul de la ușă activat și de expirarea rapidă, dar nu eliminat. (Tokenul de kiosk din mediu a fost înlocuit de Activare Ecran de la ușă, vezi [ADR-0004](0004-ecranul-de-la-usa-se-activeaza-din-aplicatie.md).)

Un cod scanat e bun pentru **o singură acțiune**: după o Intrare sau o Ieșire, următoarea acțiune a aceluiași Angajat cere un cod dintr-o fereastră de 30 s mai nouă (altfel 403 `code_invalid`, „Codul QR a fost deja folosit”), iar ecranul de pe telefon își șterge codul după confirmare. Fără asta, Ieșirea se putea apăsa imediat după Intrare, fără o nouă scanare la ușă, deci fără dovada prezenței. Regula nu cere stare nouă în baza de date: fereastra ultimei acțiuni se deduce din Sesiuni.
