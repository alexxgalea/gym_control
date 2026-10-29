/*
 * Punctul de intrare Angajat. Ecranul de la ușă (`/door`) rulează pe un telefon vechi, așa că primește un
 * pachet separat și mic (React + ecranul, fără router, react-query, Tailwind sau animații); restul adreselor
 * (`/me`, `/enroll/*`, `/status`) pornesc aplicația completă.
 */
if (window.location.pathname === "/door") {
  void import("./doorMain");
} else {
  void import("./appMain");
}
