# Gym Control

Înregistrează automat cine intră și cine iese din sala de fitness a firmei, fără recepție, camere, NFC sau turnichet. Scopul este atribuirea eventualelor pagube persoanelor prezente într-un interval orar, pentru o verificare internă ulterioară.

## Language

**Angajat**:
Persoana care folosește sala și face Intrare/Ieșire. Singurul tip de persoană urmărită.
_Avoid_: Membru, client, utilizator

**Sală**:
Spațiul fizic controlat de aplicație, cu o singură ușă de acces.
_Avoid_: Birou, locație

**Intrare**:
Evenimentul prin care un Angajat declară, validat, că a intrat în Sală.
_Avoid_: Check-in, ENTRY

**Ieșire**:
Evenimentul prin care un Angajat declară, validat, că a ieșit din Sală.
_Avoid_: Check-out, EXIT

**Sesiune**:
Perioada dintre o Intrare și Ieșirea corespunzătoare a aceluiași Angajat.
_Avoid_: Vizită, pontaj

**Sesiune deschisă**:
Sesiune cu Intrare, dar fără Ieșire. Se marchează ca Anomalie.
_Avoid_: Sesiune uitată, sesiune orfană

**Anomalie**:
Marcaj pe jurnal pentru o situație care cere verificare umană, nu o eroare tehnică (Sesiune deschisă, Intrare în afara programului, Ieșire lipsă).
_Avoid_: Alertă

**Admin**:
Persoana cu cont care activează telefoanele Angajaților, corectează Jurnalul și generează Rapoarte de prezență.
_Avoid_: Administrator, manager

**Sesiune manuală**:
Sesiune introdusă sau corectată de un Admin, cu motiv obligatoriu, și marcată vizibil ca atare.
_Avoid_: Corecție, override

**Incident**:
Interval de timp marcat de un Admin pentru o pagubă sau o problemă; datele din el nu se șterg până la închidere.
_Avoid_: Eveniment, caz

**Jurnal**:
Înregistrarea persistentă a Intrărilor, Ieșirilor, metodei de validare și Anomaliilor.
_Avoid_: Log, istoric

**Raport de prezență**:
Lista Angajaților prezenți în Sală într-un interval orar dat. Este o listă credibilă de persoane, nu o dovadă a vinovăției.
_Avoid_: Raport de pontaj

**Activare telefon**:
Legarea unui singur telefon de un Angajat, printr-un link de unică folosință; doar de pe telefonul activat se pot face Intrare și Ieșire. O nouă Activare scoate din uz telefonul anterior.
_Avoid_: Înrolare, dispozitiv

**Activare Ecran de la ușă**:
Legarea unui singur telefon de ușa Sălii, făcută de un Admin printr-un link de unică folosință; doar telefonul activat afișează codul QR. O nouă Activare scoate din uz telefonul anterior.
_Avoid_: Configurare kiosk, token de kiosk

**Ecranul de la ușă**:
Telefonul fix de lângă ușa Sălii care afișează codul QR scanat pentru Intrare și Ieșire.
_Avoid_: Kiosk, terminal, pagina de intrare

**Perioadă de păstrare**:
Numărul de luni după care Sesiunile și rândurile din Jurnal se șterg automat, cu excepția celor care se suprapun cu un Incident deschis.
_Avoid_: Retenție
