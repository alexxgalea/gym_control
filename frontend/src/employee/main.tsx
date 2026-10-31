/*
 * Punctul de intrare Angajat. Ecranul de la ușă (`/door`) primește un pachet separat și mic (React, ecranul și
 * sistemul de design, fără router sau react-query: pornește repede și depinde de cât mai puțin cod, ADR-0005);
 * restul adreselor (`/me`, `/enroll/*`, `/status`) pornesc aplicația completă.
 */
if (window.location.pathname === "/door") {
  void import("./doorMain");
} else {
  void import("./appMain");
}
