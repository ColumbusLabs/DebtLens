#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { loadConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { DEFAULT_BASELINE_FILENAME, applyBaseline, createBaseline, loadBaseline, writeBaseline } from "../core/baseline.js";
import { scan } from "../core/scan.js";
import { getChangedFiles } from "../utils/git.js";
import { parseSeverity, severityRank } from "../core/severity.js";
import type { OutputFormat } from "../core/types.js";
import { detectorIds } from "../detectors/index.js";
import { renderReport } from "../reporters/index.js";
import { runInit } from "./init.js";
import { parseCommaList, parseThresholds } from "./parseList.js";

const program = new Command();

program
  .name("debtlens")
  .description("Find maintainability debt common in fast-moving AI-assisted TypeScript and React codebases.")
  .version("0.1.1");

program.command("scan")
  .description("Scan a project, directory, or file for maintainability debt.")
  .argument("[target]", "directory or file to scan", ".")
  .option("-i, --include <patterns>", "comma-separated glob patterns to include")
  .option("-x, --exclude <patterns>", "comma-separated glob patterns to exclude")
  .option("--min-severity <severity>", "info, low, medium, or high", "low")
  .option("--rules <rules>", `comma-separated rule ids. Available: ${detectorIds.join(", ")}`)
  .option("--threshold <thresholds>", "comma-separated key=value threshold overrides")
  .option("--max-files <count>", "maximum files to scan", parseInteger)
  .option("--format <format>", "terminal, json, markdown, or sarif", "terminal")
  .option("-o, --output <path>", "write the report to a file instead of stdout")
  .option("--fail-on <severity>", "exit with code 1 when any issue meets this severity")
  .option("--baseline <path>", "report only issues absent from this baseline file")
  .option("--write-baseline [path]", "write current issues to a baseline file and exit")
  .option("--changed [ref]", "scan only files changed vs HEAD (or vs <ref> if given)")
  .option("--config <path>", "path to debtlens.config.json")
  .option("--cwd <path>", "working directory", process.cwd())
  .option("--no-color", "disable ANSI color in terminal output")
  .option("-q, --quiet", "print only the summary line, suppress individual findings")
  .action(async (target: string, rawOptions: Record<string, unknown>) => {
    try {
      const format = parseFormat(String(rawOptions.format ?? "terminal"));
      const cwd = resolve(String(rawOptions.cwd ?? process.cwd()));
      const fileConfig = loadConfig(cwd, rawOptions.config ? String(rawOptions.config) : undefined);
      const minSeverity = parseSeverity(String(rawOptions.minSeverity ?? "low"), "low");
      const failOn = rawOptions.failOn ? parseSeverity(String(rawOptions.failOn), "high") : undefined;

      let changedFiles: string[] | undefined;
      if (rawOptions.changed) {
        const base = rawOptions.changed === true ? undefined : String(rawOptions.changed);
        const changed = getChangedFiles(cwd, base);
        if (changed === null) {
          process.stderr.write("DebtLens: --changed ignored (not a git repository).\n");
        } else {
          changedFiles = changed.files;
        }
      }

      const options = mergeConfig(target, fileConfig, {
        cwd,
        include: parseCommaList(rawOptions.include as string | undefined),
        exclude: parseCommaList(rawOptions.exclude as string | undefined),
        rules: parseRuleList(rawOptions.rules as string | undefined),
        thresholds: parseThresholds(rawOptions.threshold as string | undefined),
        minSeverity,
        maxFiles: rawOptions.maxFiles as number | undefined,
        changedFiles,
      });

      if (rawOptions.writeBaseline && rawOptions.baseline) {
        throw new Error("Use either --write-baseline or --baseline, not both.");
      }

      const result = await scan(options);

      if (rawOptions.writeBaseline) {
        const baselinePath = rawOptions.writeBaseline === true
          ? DEFAULT_BASELINE_FILENAME
          : String(rawOptions.writeBaseline);
        const written = writeBaseline(cwd, baselinePath, createBaseline(result.issues));
        process.stdout.write(`Wrote baseline with ${result.issues.length} issues to ${written}\n`);
        return;
      }

      const reported = rawOptions.baseline
        ? applyBaseline(result, loadBaseline(cwd, String(rawOptions.baseline)))
        : result;

      const report = renderReport(reported, format, { color: rawOptions.color !== false && format === "terminal" && process.stdout.isTTY, quiet: rawOptions.quiet === true });

      if (rawOptions.output) {
        const outputPath = resolve(cwd, String(rawOptions.output));
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, report, "utf8");
      } else {
        process.stdout.write(report);
      }

      if (failOn && reported.issues.some((issue) => severityRank[issue.severity] >= severityRank[failOn])) {
        process.exitCode = 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`DebtLens failed: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.command("init")
  .description("Create a starter debtlens.config.json in the current directory.")
  .option("--force", "overwrite an existing config file")
  .option("--cwd <path>", "working directory", process.cwd())
  .action((rawOptions: Record<string, unknown>) => {
    try {
      const cwd = resolve(String(rawOptions.cwd ?? process.cwd()));
      const result = runInit(cwd, rawOptions.force === true);
      process.stdout.write(`${result.overwritten ? "Overwrote" : "Created"} ${result.path}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`DebtLens failed: ${message}\n`);
      process.exitCode = 1;
    }
  });

if (process.argv.length <= 2) {
  program.help();
}

await program.parseAsync(process.argv);

function parseRuleList(value: string | undefined): string[] | undefined {
  const parsed = parseCommaList(value);
  if (!parsed) return undefined;
  const aliases: Record<string, string> = {
    components: "large-component",
    component: "large-component",
    state: "state-sprawl",
    effects: "effect-complexity",
    effect: "effect-complexity",
    duplicates: "duplicate-logic",
    duplicate: "duplicate-logic",
    abstractions: "dead-abstraction",
    abstraction: "dead-abstraction",
    props: "prop-drilling",
    comments: "todo-comment",
    todos: "todo-comment",
    naming: "naming-drift",
  };
  return parsed.map((rule) => aliases[rule] ?? rule);
}

function parseInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }
  return parsed;
}

function parseFormat(value: string): OutputFormat {
  if (value === "terminal" || value === "json" || value === "markdown" || value === "sarif") return value;
  throw new Error(`Invalid format "${value}". Expected terminal, json, markdown, or sarif.`);
}
