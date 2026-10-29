Laptop vechi care pornește Linux/Windows și rămâne deschis: Docker, Python/Node, PostgreSQL sau SQLite.

Telefon Android uzat, ideal Android 8+; nu trebuie să aibă SIM sau cameră funcțională.

Încărcător permanent pentru telefon.

Suport de perete / suport de telefon.

Wi-Fi local; ideal, telefonul și laptopul pe aceeași rețea.

Opțional: un BLE beacon sau doar validare Wi-Fi.



| Problemă                             | Soluție practică                                                      |
| ------------------------------------ | --------------------------------------------------------------------- |
| Telefonul se stinge / intră în sleep | Setează Stay awake while charging, luminozitate fixă și kiosk browser |
| Laptopul se închide la capac         | Dezactivează suspendarea la închiderea capacului sau lasă-l deschis   |
| IP-ul laptopului se schimbă          | Rezervă-i IP static în router sau folosește hostname local            |
| Telefonul uzat are baterie umflată   | Nu-l folosi; înlocuiește bateria sau alege alt telefon                |
| QR-ul poate fi fotografiat           | Token TOTP cu expirare 30–60 s și semnătură HMAC                      |
| Cineva poate face check-in din birou | Cere conectivitate la Wi-Fi-ul sălii sau BLE beacon                   |
| Laptopul nu e mereu pornit           | Setează auto-boot după curent și auto-login; eventual un mic UPS      |



Telefon angajat
  -> scanază QR de pe telefonul-kiosk
  -> trimite user_id + token TOTP + timestamp
  -> server pe laptop validează Wi-Fi/BLE + token
  -> salvează ENTRY / EXIT

Telefon uzat la ușă
  -> browser kiosk
  -> pagina /door/entry sau /door/exit
  -> QR TOTP se schimbă la 30 s

Laptop vechi
  -> server local
  -> SQLite/PostgreSQL
  -> dashboard admin
  -> raport pe interval