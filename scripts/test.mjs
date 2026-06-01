#!/usr/bin/env node
// Cross-platform test runner: recursively collects tests/**/*.test.ts and runs them
// with node:test via the tsx loader. Avoids shell globbing so it works on Windows and
// on Node 20 (which lacks native glob patterns for --test).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function collect(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, acc);
    else if (entry.name.endsWith(".test.ts")) acc.push(full);
  }
  return acc;
}

const files = collect("tests");
if (files.length === 0) {
  console.error("No test files found under tests/");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
