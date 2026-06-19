import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { compareScanResults } from "../../core/scanComparison.js";
import { renderCompareReport } from "../../reporters/compareReporter.js";
import { parseCompareFormat } from "../parse.js";

export interface CompareCommandResult {
  report: string;
  exitCode: number;
  stderr: string;
}

export function registerCompareCommand(program: Command): void {
  program.command("compare")
    .description("Compare two DebtLens ScanResult JSON reports without rescanning.")
    .argument("<previous>", "previous ScanResult JSON report")
    .argument("<current>", "current ScanResult JSON report")
    .option("--format <format>", "terminal, markdown, or json", "terminal")
    .option("--cwd <path>", "working directory", process.cwd())
    .action((previousPath: string, currentPath: string, rawOptions: Record<string, unknown>) => {
      try {
        const result = runCompareCommand(previousPath, currentPath, rawOptions);
        if (result.stderr) process.stderr.write(result.stderr);
        process.stdout.write(result.report);
        if (result.exitCode !== 0) process.exitCode = result.exitCode;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`DebtLens failed: ${message}\n`);
        process.exitCode = 1;
      }
    });
}

export function runCompareCommand(
  previousPath: string,
  currentPath: string,
  rawOptions: Record<string, unknown> = {},
): CompareCommandResult {
  const cwd = resolve(String(rawOptions.cwd ?? process.cwd()));
  const format = parseCompareFormat(String(rawOptions.format ?? "terminal"));
  const previous = readJsonReport(cwd, previousPath, "previous");
  const current = readJsonReport(cwd, currentPath, "current");
  const comparison = compareScanResults(previous, current);
  return {
    report: renderCompareReport(comparison, format),
    exitCode: 0,
    stderr: comparison.warnings.map((warning) => `DebtLens warning: ${warning}\n`).join(""),
  };
}

function readJsonReport(
  cwd: string,
  reportPath: string,
  label: "previous" | "current",
): unknown {
  const target = resolve(cwd, reportPath);
  try {
    return JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${label} report at ${target}: ${message}`);
  }
}
