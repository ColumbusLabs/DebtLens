import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");
const builtCliEntrypoint = join(repoRoot, "dist", "cli", "index.js");
const fixturesRoot = join(repoRoot, "tests", "benchmarks", "fixtures");
const fixtureNames = readdirSync(fixturesRoot).sort();
const args = process.argv.slice(2);
const defaultBudgets = { small: 5000, medium: 30000, large: 120000 };
let failed = false;

function usage() {
  console.log(`Usage: node scripts/benchmark.mjs [--small-only] [--budget fixture=ms] [--compare-parallel]

Options:
  --small-only             Run only the small fixture for fast CI smoke checks.
  --budget fixture=ms      Override a fixture budget. May be repeated or comma-separated.
  --compare-parallel       Compare built serial/worker scans on the large fixture.
  --runs <count>           Measured comparison runs after warmup (default: 3).
  --min-speedup <ratio>    Required median serial/parallel ratio (default: 1.05).

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
    if (arg === "--help" || arg === "-h" || arg === "--small-only" || arg === "--compare-parallel") continue;
    if (arg === "--budget" || arg === "--runs" || arg === "--min-speedup") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--budget=") || arg.startsWith("--runs=") || arg.startsWith("--min-speedup=")) continue;
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

if (args.includes("--compare-parallel")) {
  try {
    runParallelComparison();
  } catch (error) {
    console.error(error.message);
    failed = true;
  }
}

if (failed) process.exit(1);

function runParallelComparison() {
  if (!existsSync(builtCliEntrypoint)) {
    throw new Error("Parallel comparison requires built output. Run `npm run build` first.");
  }
  const runs = parsePositiveInteger(readSingleOption("--runs") ?? "3", "--runs");
  const minSpeedup = parseBudgetMs(readSingleOption("--min-speedup") ?? "1.05", "--min-speedup");
  const target = createParallelBenchmarkFixture();
  const rules = "large-function,cognitive-complexity,complex-control-flow,long-parameter-list,god-file,todo-comment,commented-out-code,empty-catch,swallowed-error,floating-promise,dead-abstraction";
  const serialMs = [];
  const parallelMs = [];
  let expectedFindings;

  // Discard one run per mode so module and filesystem startup do not dominate
  // the measured medians. Built JS is intentional: source/tsx worker startup is
  // a development-mode cost, not the published CLI runtime.
  try {
    runBuiltScan(target, 1, rules);
    runBuiltScan(target, 4, rules);

    for (let index = 0; index < runs; index += 1) {
      const order = index % 2 === 0 ? [1, 4] : [4, 1];
      for (const concurrency of order) {
        const result = runBuiltScan(target, concurrency, rules);
        const findings = JSON.stringify(result.issues);
        expectedFindings ??= findings;
        if (findings !== expectedFindings) {
          throw new Error(`Parallel comparison correctness failure at concurrency ${concurrency}: findings differ byte-for-byte.`);
        }
        (concurrency === 1 ? serialMs : parallelMs).push(result.summary.elapsedMs);
      }
    }

    const serialMedian = median(serialMs);
    const parallelMedian = median(parallelMs);
    const speedup = serialMedian / parallelMedian;
    const passed = speedup >= minSpeedup;
    console.log(`\nparallel comparison (generated large CPU fixture, 240 files, built JS): serial median ${serialMedian}ms, parallel median ${parallelMedian}ms, ${speedup.toFixed(2)}x speedup (required >= ${minSpeedup.toFixed(2)}x) ${passed ? "OK" : "FAIL"}`);
    console.log(`findings: byte-identical across ${runs * 2} measured scans`);
    if (!passed) failed = true;
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
}

function runBuiltScan(target, concurrency, rules) {
  const result = spawnSync(process.execPath, [
    builtCliEntrypoint,
    "scan",
    target,
    "--format",
    "json",
    "--min-severity",
    "info",
    "--concurrency",
    String(concurrency),
    ...(rules ? ["--rules", rules] : []),
  ], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Built scan exited ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

function createParallelBenchmarkFixture() {
  const root = mkdtempSync(join(tmpdir(), "debtlens-parallel-benchmark-"));
  const sourceDir = join(root, "src");
  mkdirSync(sourceDir);
  for (let fileIndex = 0; fileIndex < 240; fileIndex += 1) {
    const functions = [];
    for (let functionIndex = 0; functionIndex < 10; functionIndex += 1) {
      functions.push(`export function workload_${fileIndex}_${functionIndex}(input: number, alpha: number, beta: number) {
  let total = input + ${fileIndex + functionIndex};
  for (let index = 0; index < 24; index += 1) {
    if (index % 2 === 0) total += alpha;
    else total += beta;
  }
  return total;
}`);
    }
    writeFileSync(join(sourceDir, `module-${fileIndex}.ts`), `${functions.join("\n\n")}\n`, "utf8");
  }
  return root;
}

function readSingleOption(flag) {
  const values = readOptionValues(flag);
  if (values.length > 1) throw new Error(`${flag} may only be provided once`);
  return values[0];
}

function parsePositiveInteger(rawValue, label) {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
