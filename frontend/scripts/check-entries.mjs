// Verifică build-ul (dist/.vite/manifest.json): există ambele puncte de intrare, iar cele două împart doar
// sistemul de design. Punctul de intrare Angajat nu are voie să includă cod din interfața Admin (ADR-0003).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(dist, ".vite/manifest.json"), "utf8"));

const problems = [];
for (const page of ["index.html", "employee.html"]) {
  if (!existsSync(join(dist, page))) problems.push(`lipsește ${page} din build`);
}

/** Toate fișierele sursă din graful de importuri al unui punct de intrare (static; importurile dinamice sunt incluse). */
function sources(key, seen = new Set()) {
  const chunk = manifest[key];
  if (!chunk || seen.has(key)) return seen;
  seen.add(key);
  for (const next of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) sources(next, seen);
  return seen;
}

// Fișierele sursă care există doar pentru Admin; nimic din ele nu poate ajunge în punctul de intrare Angajat.
const ADMIN_ONLY = /^src\/(screens\/|auth\.tsx|App\.tsx|api\/client\.ts|queryClient\.ts|main\.tsx)/;
const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry);
const employee = entries.find(([, chunk]) => chunk.src === "employee.html");
const admin = entries.find(([, chunk]) => chunk.src === "index.html");
if (!employee || !admin) {
  problems.push("manifestul nu conține ambele puncte de intrare");
} else {
  const employeeFiles = [...sources(employee[0])].map((key) => manifest[key]?.src ?? key);
  const leaked = employeeFiles.filter((file) => ADMIN_ONLY.test(file));
  if (leaked.length) problems.push(`punctul de intrare Angajat include cod Admin: ${leaked.join(", ")}`);
  const adminFiles = new Set([...sources(admin[0])].map((key) => manifest[key]?.src ?? key));
  const shared = employeeFiles.filter((file) => adminFiles.has(file) && file.startsWith("src/"));
  const outsideDesign = shared.filter((file) => !/^src\/(design\/|lib\/)/.test(file));
  if (outsideDesign.length) problems.push(`Admin și Angajat împart, în afara sistemului de design: ${outsideDesign.join(", ")}`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Cele două puncte de intrare sunt în build și împart doar sistemul de design.");
