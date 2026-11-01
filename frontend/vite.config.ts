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
    // Ținta implicită din Vite (browsere moderne): și telefonul de la ușă e unul nou (ADR-0005, înlocuiește ținta
    // coborâtă din ADR-0003). Tailwind 4 cere oricum Chrome 111+.
    manifest: true, // folosit de `scripts/check-entries.mjs`
    rollupOptions: { input: { admin: path.resolve(__dirname, "index.html"), employee: path.resolve(__dirname, "employee.html") } },
  },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
