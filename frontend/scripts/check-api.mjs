// Pică (exit 1) dacă schema OpenAPI a aplicației sau tipurile TS generate din ea nu sunt la zi.
// Remediu: `npm run gen:api` și commit.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const frontend = new URL("..", import.meta.url).pathname;
const root = join(frontend, "..");

const schema = execFileSync("uv", ["run", "python", "scripts/export_openapi.py"], { cwd: root, encoding: "utf8" });
const committedSchema = readFileSync(join(frontend, "openapi.json"), "utf8");

const tmp = mkdtempSync(join(tmpdir(), "gc-api-"));
const generated = join(tmp, "schema.d.ts");
execFileSync("npx", ["openapi-typescript", "openapi.json", "-o", generated], { cwd: frontend, stdio: "ignore" });
const committedTypes = readFileSync(join(frontend, "src/api/schema.d.ts"), "utf8");

const problems = [];
if (schema !== committedSchema) problems.push("frontend/openapi.json nu corespunde schemei aplicației");
if (readFileSync(generated, "utf8") !== committedTypes) problems.push("frontend/src/api/schema.d.ts nu corespunde openapi.json");

if (problems.length) {
  console.error(problems.join("\n") + "\nRulează `npm run gen:api` în frontend/ și fă commit.");
  process.exit(1);
}
console.log("Tipurile TS generate sunt la zi.");
