/// <reference types="vitest/config" />
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Două puncte de intrare într-un singur build: Admin (index.html, la /admin/*) și Angajat (employee.html, servit de
// aplicație la /status etc.). Fișierele statice ale ambelor stau sub /admin/assets/.
// SPA servit de aplicație la /admin/; în dezvoltare, proxy către aplicația Python (uvicorn pe :8000).
export default defineConfig({
  base: "/admin/",
  build: {
    // Telefonul de la ușă e vechi, cu versiune de browser necunoscută (ADR-0003, „Ținta de build”): ținta e coborâtă
    // pentru tot build-ul (Vite nu are ținte pe punct de intrare). esbuild coboară sintaxa (`?.`, `??`, câmpuri de clasă...).
    target: ["chrome64", "safari11", "firefox78"],
    manifest: true, // folosit de `scripts/check-entries.mjs`
    rollupOptions: { input: { admin: path.resolve(__dirname, "index.html"), employee: path.resolve(__dirname, "employee.html") } },
  },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: false },
      // CSS-ul paginilor servite de aplicație.
      "/static": "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
