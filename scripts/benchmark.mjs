import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");
const fixturesRoot = join(repoRoot, "tests", "benchmarks", "fixtures");
const fixtureNames = readdirSync(fixturesRoot).sort();
const args = process.argv.slice(2);
const defaultBudgets = { small: 5000, medium: 30000, large: 120000 };
let failed = false;

function usage() {
  console.log(`Usage: node scripts/benchmark.mjs [--small-only] [--budget fixture=ms]

Options:
  --small-only             Run only the small fixture for fast CI smoke checks.
  --budget fixture=ms      Override a fixture budget. May be repeated or comma-separated.

Environment:
  DEBTLENS_BENCHMARK_BUDGETS       Comma-separated fixture=ms overrides.
  DEBTLENS_BENCHMARK_BUDGET_<NAME>_MS
                                   Override one fixture budget, e.g. SMALL.
`);
}

function readOptionValues(flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
      values.push(value);
      index += 1;
    } else if (arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
    }
  }
  return values;
}

function assertKnownArgs() {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h" || arg === "--small-only") continue;
    if (arg === "--budget") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--budget=")) continue;
    throw new Error(`Unknown benchmark option: ${arg}`);
  }
}

function parseBudgetMs(rawValue, label) {
  const budgetMs = Number(rawValue);
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error(`${label} must be a positive millisecond value`);
  }
  return budgetMs;
}

function applyBudgetOverrides(budgets, rawOverrides, source) {
  for (const rawOverride of rawOverrides) {
    for (const entry of rawOverride.split(",")) {
      const trimmed = entry.trim();
      if (trimmed.length === 0) continue;

      const [rawName, rawBudget, ...rest] = trimmed.split("=");
      const name = rawName?.trim();
      const value = rawBudget?.trim();
      if (!name || !value || rest.length > 0) {
        throw new Error(`${source} budget override must use fixture=ms`);
      }
      if (!fixtureNames.includes(name)) {
        throw new Error(`${source} budget override references unknown fixture "${name}"`);
      }
      budgets[name] = parseBudgetMs(value, `${source} budget for ${name}`);
    }
  }
}

try {
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(0);
  }

  assertKnownArgs();
} catch (error) {
  console.error(error.message);
  usage();
  process.exit(1);
}

const filter = args.includes("--small-only") ? ["small"] : fixtureNames;
const budgets = { ...defaultBudgets };

try {
  const envBudgetOverrides = [];
  if (process.env.DEBTLENS_BENCHMARK_BUDGETS) {
    envBudgetOverrides.push(process.env.DEBTLENS_BENCHMARK_BUDGETS);
  }

  for (const name of fixtureNames) {
    const envName = `DEBTLENS_BENCHMARK_BUDGET_${name.toUpperCase().replaceAll("-", "_")}_MS`;
    if (process.env[envName]) {
      envBudgetOverrides.push(`${name}=${process.env[envName]}`);
    }
  }

  applyBudgetOverrides(budgets, envBudgetOverrides, "Environment");
  applyBudgetOverrides(budgets, readOptionValues("--budget"), "CLI");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

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
