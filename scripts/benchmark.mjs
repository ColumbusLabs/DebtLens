import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");
const fixturesRoot = join(repoRoot, "tests", "benchmarks", "fixtures");
const filter = process.argv.includes("--small-only") ? ["small"] : readdirSync(fixturesRoot).sort();
const budgets = { small: 5000, medium: 30000, large: 120000 };
let failed = false;

console.log("DebtLens benchmark fixtures\n");

for (const name of filter) {
  const target = join(fixturesRoot, name);
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    cliEntrypoint,
    "scan",
    target,
    "--format",
    "json",
    "--min-severity",
    "info",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    failed = true;
    continue;
  }

  const parsed = JSON.parse(result.stdout);
  const elapsedMs = parsed.summary.elapsedMs;
  const filesScanned = parsed.summary.filesScanned;
  const budget = budgets[name];
  const withinBudget = budget === undefined || elapsedMs < budget;

  console.log(`${name}: ${elapsedMs}ms (${filesScanned} files)${budget !== undefined ? ` budget < ${budget}ms` : ""} ${withinBudget ? "OK" : "FAIL"}`);
  if (!withinBudget) failed = true;
}

if (failed) process.exit(1);
