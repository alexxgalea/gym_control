# PROTOTIP: Ecranul de la ușă și meniul de Admin

Ramură de aruncat (`prototype/ecran-usa-si-meniu`): nu se unește în main. Răspunde la întrebarea „cum arată
Ecranul de la ușă pe fundal închis și cum arată un meniu de Admin smart?”, după deciziile din sesiunea de
grilling (ADR-0005 pentru Ecranul de la ușă).

## Variante

| Ecran | `?variant=` | Ce încearcă |
| --- | --- | --- |
| Ecranul de la ușă (`/door`) | `A` Aurora | centrat, titlu mare, QR pe card alb cu contur-cronometru, pastilă „Cod nou în N s”, pete de lumină care se mișcă lent |
| | `B` Ghid pas cu pas | bară sus cu ceas, QR, panou de sticlă cu cei 3 pași și secundele mari, rază de lumină care trece pe diagonală |
| | `C` Halo, imersiv | aproape fără text, QR cât mai mare, halou conic rotitor, secundele într-o insignă pe contur, grilă de puncte care alunecă |
| | `0` | ecranul actual |
| Admin (`/admin/`) | `A` Andocat | telefon: bară de jos lipită de margine, ＋ rotund ridicat; desktop: bară laterală grupată, restrângibilă, cu acțiuni rapide |
| | `B` Plutitor | telefon: pastilă de sticlă plutitoare, „Mai mult” ca grilă de plăcuțe colorate; desktop: șină îngustă de iconițe |
| | `C` Centru de comandă | telefon: căutare mare sus și jetoane de stare (în Sală, Anomalii, Incidente, ușa); desktop: card „Acum în Sală” deasupra meniului |
| | `0` | meniul actual |

Toate variantele de Admin au cifre (Anomalii, Incidente deschise, câți sunt în Sală, punct roșu când ușa nu e
activată) și căutare rapidă `Ctrl+K`. Bara roz de comutare (← →, și săgețile de pe tastatură) apare sus în Admin
și jos pe ușă; `?shot=1` o ascunde, `?stale=1` pe ușă arată avertismentul.

## Pornire

O singură comandă, din rădăcina repo-ului (cere `uv` și Node 22+):

```
scripts/prototip.sh                                   # doar de pe laptop
HOST=0.0.0.0 SUBNET=192.168.0.0/24 scripts/prototip.sh   # și de pe telefon, din aceeași rețea Wi-Fi
```

Scriptul face build-ul, pornește serverul cu o bază de test nouă, pune date demo și afișează adresele, inclusiv
un link de Activare pentru Ecranul de la ușă. Capturile din acest folder sunt făcute cu `shoot.cjs` (Playwright).

## Observații pentru implementare

- SVG-ul QR de la server are doar `width`/`height`, fără `viewBox`, deci nu se scalează: la implementare,
  `omitsize=True` în `segno` (prototipul îl rescrie în browser).
- `/incidents?nou` deschide direct foaia „Incident nou” (ca `/employees?nou`), pentru acțiunea rapidă.
- Textul „Codul se schimbă automat la 30 de secunde” trebuie să vină din `period_seconds`.
