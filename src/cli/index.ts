#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { findConfigPath, loadConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { listRulePacks, RULE_PACK_IDS } from "../config/packs.js";
import { resolveWorkspacePackage } from "../config/workspaces.js";
import { DEFAULT_BASELINE_FILENAME, applyBaseline, createBaseline, loadBaseline, writeBaseline } from "../core/baseline.js";
import { scan } from "../core/scan.js";
import { getChangedFiles, getLineIntroducedDaysAgo, getRefSnapshot, getStagedFiles } from "../utils/git.js";
import { parseSeverity, severityRank } from "../core/severity.js";
import type { DebtIssue, DebtLensConfig, Detector, OutputFormat, ScanOptions, ScanResult, ScanThresholds, Severity, TerminalGroupBy } from "../core/types.js";
import { allDetectors, detectorIds } from "../detectors/index.js";
import { loadPlugins } from "../plugins/loadPlugins.js";
import { packageVersion } from "../utils/packageInfo.js";
import { renderReport } from "../reporters/index.js";
import { runExplain } from "./explain.js";
import { runInit } from "./init.js";
import { runSuppress } from "./suppress.js";
import { runDoctor } from "./doctor.js";
import { runAdopt } from "./adopt.js";
import { renderCompletions, type CompletionShell } from "./completions.js";
import { parseCommaList, parseThresholds } from "./parseList.js";
import { buildZeroFilesScannedWarning } from "./scanWarnings.js";
import { suggestConfigFromEslint } from "./eslintMigration.js";
import { runWatch } from "./watch.js";
import { runMcpServer } from "./mcp.js";

const program = new Command();

program
  .name("debtlens")
  .description("Find maintainability debt common in fast-moving AI-assisted TypeScript and React codebases.")
  .version(packageVersion);

program.command("scan")
  .description("Scan a project, directory, or file for maintainability debt.")
  .argument("[target]", "directory or file to scan", ".")
  .option("-i, --include <patterns>", "comma-separated glob patterns to include")
  .option("-x, --exclude <patterns>", "comma-separated glob patterns to exclude")
  .option("--min-severity <severity>", "info, low, medium, or high", "low")
  .option("--pack <pack>", `built-in rule pack preset (${RULE_PACK_IDS.join(", ")})`)
  .option("--rules <rules>", `comma-separated rule ids. Available: ${detectorIds.join(", ")}`)
  .option("--threshold <thresholds>", "comma-separated key=value threshold overrides")
  .option("--max-files <count>", "maximum files to scan", parseInteger)
  .option("--format <format>", "terminal, json, markdown, pr-comment, sarif, html, or junit", "terminal")
  .option("-o, --output <path>", "write the report to a file instead of stdout")
  .option("--fail-on <severity>", "exit with code 1 when any issue meets this severity")
  .option("--fail-on-confidence <0-1>", "with --fail-on, require at least this confidence to fail", parseConfidence)
  .option("--fail-on-regression", "exit with code 1 when counts increase versus --baseline or --diff-base")
  .option("--baseline <path>", "report only issues absent from this baseline file")
  .option("--diff-base <ref>", "report only findings introduced since this git ref")
  .option("--write-baseline [path]", "write current issues to a baseline file and exit")
  .option("--changed [ref]", "scan only files changed vs HEAD (or vs <ref> if given)")
  .option("--staged", "scan only files staged in git")
  .option("--respect-gitignore", "skip files ignored by git")
  .option("--config <path>", "path to debtlens.config.json")
  .option("--cwd <path>", "working directory", process.cwd())
  .option("--package <name>", "scan a single workspace package by name")
  .option("--no-color", "disable ANSI color in terminal output")
  .option("-q, --quiet", "print only the summary line, suppress individual findings")
  .option("--profile", "print per-rule timing without changing findings")
  .option("--cache [path]", "reuse unchanged scan results from a content-hash cache")
  .option("--parallel", "run detectors concurrently after source loading")
  .option("--batch-size <count>", "load source files in bounded batches", parseInteger)
  .option("--blame-age", "add introducedDaysAgo metadata to JSON issues using git blame")
  .option("--group-by <group>", "terminal grouping: severity, rule, or file", "severity")
  .option("--sarif-compact", "with --format sarif, emit only rules referenced by findings")
  .option("--markdown-heatmap [limit]", "with --format markdown, append a debt heatmap table", parseOptionalInteger)
  .action(async (target: string, rawOptions: Record<string, unknown>) => {
    try {
      const format = parseFormat(String(rawOptions.format ?? "terminal"));
      const groupBy = parseGroupBy(String(rawOptions.groupBy ?? "severity"));
      const cwd = resolve(String(rawOptions.cwd ?? process.cwd()));
      const fileConfig = loadConfig(cwd, rawOptions.config ? String(rawOptions.config) : undefined);
      const pluginContribution = await loadConfiguredPlugins(cwd, rawOptions, fileConfig);
      const minSeverity = parseSeverity(String(rawOptions.minSeverity ?? "low"), "low");
      const failOn = resolveFailOn(rawOptions, fileConfig);
      const failOnConfidence = resolveFailOnConfidence(rawOptions, fileConfig);

      let changedFiles: string[] | undefined;
      let fileContents: Record<string, string> | undefined;
      if (rawOptions.staged === true && rawOptions.changed !== undefined) {
        throw new Error("Use either --staged or --changed, not both.");
      }

      if (rawOptions.changed) {
        const base = rawOptions.changed === true ? undefined : String(rawOptions.changed);
        const changed = getChangedFiles(cwd, base);
        if (changed === null) {
          process.stderr.write("DebtLens: --changed ignored (not a git repository).\n");
        } else {
          changedFiles = changed.files;
        }
      } else if (rawOptions.staged === true) {
        const staged = getStagedFiles(cwd);
        if (staged === null) {
          process.stderr.write("DebtLens: --staged ignored (not a git repository).\n");
        } else {
          changedFiles = staged.files;
          fileContents = staged.contents;
        }
      }

      let scanTarget = target;
      if (rawOptions.package) {
        const workspacePackage = resolveWorkspacePackage(cwd, String(rawOptions.package));
        scanTarget = workspacePackage.directory;
      }

      const options = mergeConfig(scanTarget, fileConfig, {
        cwd,
        include: parseCommaList(rawOptions.include as string | undefined),
        exclude: parseCommaList(rawOptions.exclude as string | undefined),
        rules: parseRuleList(rawOptions.rules as string | undefined),
        pack: rawOptions.pack ? String(rawOptions.pack) : undefined,
        thresholds: parseThresholds(rawOptions.threshold as string | undefined),
        minSeverity,
        maxFiles: rawOptions.maxFiles as number | undefined,
        cache: rawOptions.cache !== undefined ? true : undefined,
        cachePath: typeof rawOptions.cache === "string" ? rawOptions.cache : undefined,
        parallel: rawOptions.parallel === true ? true : undefined,
        batchSize: rawOptions.batchSize as number | undefined,
        respectGitignore: rawOptions.respectGitignore === true ? true : undefined,
        changedFiles,
        fileContents,
        profile: rawOptions.profile === true,
        pluginDetectors: pluginContribution?.detectors,
        pluginThresholds: pluginContribution?.thresholds,
        pluginVocabulary: pluginContribution?.vocabulary,
      });

      if (rawOptions.writeBaseline && rawOptions.baseline) {
        throw new Error("Use either --write-baseline or --baseline, not both.");
      }
      if (rawOptions.diffBase && rawOptions.baseline) {
        throw new Error("Use either --diff-base or --baseline, not both.");
      }
      if (rawOptions.failOnRegression === true && !rawOptions.baseline && !rawOptions.diffBase) {
        throw new Error("Use --fail-on-regression with --baseline or --diff-base.");
      }

      const result = await scan(options);

      if (result.summary.filesScanned === 0) {
        process.stderr.write(buildZeroFilesScannedWarning(options.target, options.include, rawOptions.changed !== undefined || rawOptions.staged === true));
      }

      if (result.summary.warnings?.length) {
        for (const warning of result.summary.warnings) {
          process.stderr.write(`DebtLens warning: ${warning}\n`);
        }
      }

      if (rawOptions.profile === true && result.summary.profile) {
        process.stderr.write(formatProfileReport(result.summary.profile.ruleTimingsMs));
      }

      if (rawOptions.writeBaseline) {
        const baselinePath = rawOptions.writeBaseline === true
          ? DEFAULT_BASELINE_FILENAME
          : String(rawOptions.writeBaseline);
        const written = writeBaseline(cwd, baselinePath, createBaseline(result.issues));
        process.stdout.write(`Wrote baseline with ${result.issues.length} issues to ${written}\n`);
        return;
      }

      const reported = await resolveReportedIssues(result, {
        cwd,
        baselinePath: rawOptions.baseline ? String(rawOptions.baseline) : undefined,
        diffBase: rawOptions.diffBase ? String(rawOptions.diffBase) : undefined,
        scanOptions: options,
      });
      if (rawOptions.blameAge === true) {
        enrichIssuesWithBlameAge(cwd, options, reported);
      }

      const report = renderReport(reported, format, {
        color: rawOptions.color !== false && format === "terminal" && process.stdout.isTTY === true,
        quiet: rawOptions.quiet === true,
        sourceUrlBase: format === "pr-comment" ? getGitHubSourceUrlBase(process.env) : undefined,
        groupBy,
        sarifCompact: rawOptions.sarifCompact === true,
        markdownHeatmapLimit: normalizeOptionalLimit(rawOptions.markdownHeatmap, 10),
      });

      if (rawOptions.output) {
        const outputPath = resolve(cwd, String(rawOptions.output));
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, report, "utf8");
      } else {
        process.stdout.write(report);
      }

      if (failOn && reported.issues.some((issue) => shouldFailOnIssue(issue, failOn, failOnConfidence))) {
        process.exitCode = 1;
      }
      if (rawOptions.failOnRegression === true && shouldFailOnRegression(reported)) {
        process.exitCode = 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`DebtLens failed: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.command("doctor")
  .description("Inspect resolved config and file matching without running detectors.")
  .argument("[target]", "directory or file to inspect", ".")
  .option("-i, --include <patterns>", "comma-separated glob patterns to include")
  .option("-x, --exclude <patterns>", "comma-separated glob patterns to exclude")
  .option("--min-severity <severity>", "info, low, medium, or high", "low")
  .option("--pack <pack>", `built-in rule pack preset (${RULE_PACK_IDS.join(", ")})`)
  .option("--rules <rules>", `comma-separated rule ids. Available: ${detectorIds.join(", ")}`)
  .option("--max-files <count>", "maximum files to scan", parseInteger)
  .option("--baseline <path>", "baseline path to report (not loaded)")
  .option("--changed [ref]", "include git changed-file diagnostics")
  .option("--staged", "include git staged-file diagnostics")
  .option("--respect-gitignore", "skip files ignored by git")
  .option("--config <path>", "path to debtlens.config.json")
  .option("--cwd <path>", "working directory", process.cwd())
  .action(async (target: string, rawOptions: Record<string, unknown>) => {
    try {
      const cwd = resolve(String(rawOptions.cwd ?? process.cwd()));
      if (rawOptions.staged === true && rawOptions.changed !== undefined) {
        throw new Error("Use either --staged or --changed, not both.");
      }

      let changedFiles: string[] | undefined;
      let changedIgnored = false;
      let stagedIgnored = false;
      let gitChangedCount: number | undefined;
      let gitStagedCount: number | undefined;

      if (rawOptions.changed) {
        const base = rawOptions.changed === true ? undefined : String(rawOptions.changed);
        const changed = getChangedFiles(cwd, base);
        if (changed === null) {
          changedIgnored = true;
        } else {
          changedFiles = changed.files;
          gitChangedCount = changed.files.length;
        }
      } else if (rawOptions.staged === true) {
        const staged = getStagedFiles(cwd);
        if (staged === null) {
          stagedIgnored = true;
        } else {
          changedFiles = staged.files;
          gitStagedCount = staged.files.length;
        }
      }

      const report = await runDoctor({
        target,
        cwd,
        configPath: rawOptions.config ? String(rawOptions.config) : undefined,
        baselinePath: rawOptions.baseline ? String(rawOptions.baseline) : undefined,
        usedChanged: rawOptions.changed !== undefined,
        usedStaged: rawOptions.staged === true,
        changedIgnored,
        stagedIgnored,
        gitChangedCount,
        gitStagedCount,
        cliOptions: {
          cwd,
          include: parseCommaList(rawOptions.include as string | undefined),
          exclude: parseCommaList(rawOptions.exclude as string | undefined),
          rules: parseRuleList(rawOptions.rules as string | undefined),
          pack: rawOptions.pack ? String(rawOptions.pack) : undefined,
          minSeverity: parseSeverity(String(rawOptions.minSeverity ?? "low"), "low"),
          maxFiles: rawOptions.maxFiles as number | undefined,
          respectGitignore: rawOptions.respectGitignore === true ? true : undefined,
          changedFiles,
        },
      });

      process.stdout.write(report.text);
      if (!report.ok) {
        process.exitCode = 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`DebtLens failed: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.command("watch")
  .description("Re-run scans when files change during local development.")
  .argument("[target]", "directory or file to scan", ".")
  .option("-i, --include <patterns>", "comma-separated glob patterns to include")
  .option("-x, --exclude <patterns>", "comma-separated glob patterns to exclude")
  .option("--min-severity <severity>", "info, low, medium, or high", "low")
  .option("--pack <pack>", `built-in rule pack preset (${RULE_PACK_IDS.join(", ")})`)
  .option("--rules <rules>", `comma-separated rule ids. Available: ${detectorIds.join(", ")}`)
  .option("--threshold <thresholds>", "comma-separated key=value threshold overrides")
  .option("--max-files <count>", "maximum files to scan", parseInteger)
  .option("--format <format>", "terminal, json, markdown, pr-comment, sarif, html, or junit", "terminal")
  .option("-o, --output <path>", "write the report to a file instead of stdout")
  .option("--fail-on <severity>", "exit with code 1 when any issue meets this severity")
  .option("--fail-on-confidence <0-1>", "with --fail-on, require at least this confidence to fail", parseConfidence)
  .option("--fail-on-regression", "exit with code 1 when counts increase versus --baseline or --diff-base")
  .option("--baseline <path>", "report only issues absent from this baseline file")
  .option("--write-baseline [path]", "not supported in watch mode")
  .option("--changed [ref]", "scan only files changed vs HEAD (or vs <ref> if given)")
  .option("--staged", "scan only files staged in git")
  .option("--respect-gitignore", "skip files ignored by git")
  .option("--config <path>", "path to debtlens.config.json")
  .option("--cwd <path>", "working directory", process.cwd())
  .option("--package <name>", "scan a single workspace package by name")
  .option("--no-color", "disable ANSI color in terminal output")
  .option("-q, --quiet", "print only the summary line, suppress individual findings")
  .option("--profile", "print per-rule timing without changing findings")
  .option("--cache [path]", "reuse unchanged scan results from a content-hash cache")
  .option("--parallel", "run detectors concurrently after source loading")
  .option("--batch-size <count>", "load source files in bounded batches", parseInteger)
  .option("--blame-age", "add introducedDaysAgo metadata to JSON issues using git blame")
  .option("--group-by <group>", "terminal grouping: severity, rule, or file", "severity")
  .option("--sarif-compact", "with --format sarif, emit only rules referenced by findings")
  .option("--markdown-heatmap [limit]", "with --format markdown, append a debt heatmap table", parseOptionalInteger)
  .option("--debounce <ms>", "watch debounce in milliseconds", parseInteger)
  .action((target: string, rawOptions: Record<string, unknown>) => {
    try {
      runWatch({
        cwd: resolve(String(rawOptions.cwd ?? process.cwd())),
        target,
        rawOptions,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`DebtLens failed: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.command("packs")
  .description("List built-in rule pack presets.")
  .option("--format <format>", "terminal or json", "terminal")
  .action((rawOptions: Record<string, unknown>) => {
    try {
      const format = parseRulesFormat(String(rawOptions.format ?? "terminal"));
      const packs = listRulePacks().map((pack) => ({
        id: pack.id,
        description: pack.description,
        rules: pack.rules,
      }));

      if (format === "json") {
        process.stdout.write(`${JSON.stringify({ packs }, null, 2)}\n`);
        return;
      }

      process.stdout.write(renderPacksTable(packs));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`DebtLens failed: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.command("rules")
  .description("List built-in DebtLens rule ids.")
  .option("--format <format>", "terminal or json", "terminal")
  .action((rawOptions: Record<string, unknown>) => {
    try {
      const format = parseRulesFormat(String(rawOptions.format ?? "terminal"));
      const rules = allDetectors.map((detector) => ({
        id: detector.id,
        name: detector.name,
        defaultSeverity: detector.defaultSeverity,
        description: detector.description,
      }));

      if (format === "json") {
        process.stdout.write(`${JSON.stringify({ rules }, null, 2)}\n`);
        return;
      }

      process.stdout.write(renderRulesTable(rules));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`DebtLens failed: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.command("completions")
  .description("Print shell completions for bash, zsh, or fish.")
  .argument("<shell>", "bash, zsh, or fish")
  .action((shell: string) => {
    try {
      process.stdout.write(renderCompletions(parseCompletionShell(shell)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`DebtLens failed: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.command("mcp")
  .description("Run the DebtLens MCP stdio server.")
  .action(() => {
    runMcpServer();
  });

program.command("explain")
  .description("Print rule documentation, default thresholds, and false-positive guidance.")
  .argument("<rule>", "rule id, e.g. prop-drilling")
  .action((rule: string) => {
    try {
      process.stdout.write(runExplain(rule));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`DebtLens failed: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.command("suppress")
  .description("Print a copy-paste inline suppression comment for a finding.")
  .requiredOption("--rule <rule>", "rule id to suppress, e.g. todo-comment")
  .requiredOption("--reason <text>", "why the finding is acceptable (required by the scanner)")
  .option("--file", "emit a file-level directive instead of next-line")
  .action((rawOptions: Record<string, unknown>) => {
    try {
      process.stdout.write(runSuppress({
        ruleId: String(rawOptions.rule),
        reason: String(rawOptions.reason),
        file: rawOptions.file === true,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`DebtLens failed: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.command("init")
  .description("Create a starter debtlens.config.json in the current directory.")
  .option("--force", "overwrite an existing config file")
  .option("--pack <pack>", `built-in rule pack preset (${RULE_PACK_IDS.join(", ")})`)
  .option("--from-eslint <path>", "print a suggested config from an ESLint JSON config without writing")
  .option("--cwd <path>", "working directory", process.cwd())
  .action((rawOptions: Record<string, unknown>) => {
    try {
      const cwd = resolve(String(rawOptions.cwd ?? process.cwd()));
      if (rawOptions.fromEslint) {
        process.stdout.write(suggestConfigFromEslint(cwd, String(rawOptions.fromEslint)));
        return;
      }

      const pack = rawOptions.pack ? String(rawOptions.pack) : undefined;
      const result = runInit(cwd, rawOptions.force === true, pack);
      process.stdout.write(`${result.overwritten ? "Overwrote" : "Created"} ${result.path}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`DebtLens failed: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.command("adopt")
  .description("Scan and print an adoption summary; optionally write config and baseline.")
  .argument("[target]", "directory or file to scan", ".")
  .option("-i, --include <patterns>", "comma-separated glob patterns to include")
  .option("-x, --exclude <patterns>", "comma-separated glob patterns to exclude")
  .option("--min-severity <severity>", "info, low, medium, or high", "low")
  .option("--pack <pack>", `built-in rule pack preset (${RULE_PACK_IDS.join(", ")})`)
  .option("--rules <rules>", `comma-separated rule ids. Available: ${detectorIds.join(", ")}`)
  .option("--threshold <thresholds>", "comma-separated key=value threshold overrides")
  .option("--config <path>", "path to debtlens.config.json")
  .option("--cwd <path>", "working directory", process.cwd())
  .option("--package <name>", "scan a single workspace package by name")
  .option("--write-config", "write debtlens.config.json")
  .option("--force", "overwrite an existing config file (required with --write-config)")
  .option("--write-baseline [path]", "write baseline file (skipped when 0 issues)")
  .option("--format <format>", "terminal or markdown", "terminal")
  .action(async (target: string, rawOptions: Record<string, unknown>) => {
    try {
      const cwd = resolve(String(rawOptions.cwd ?? process.cwd()));
      const report = await runAdopt({
        target,
        cwd,
        configPath: rawOptions.config ? String(rawOptions.config) : undefined,
        pack: rawOptions.pack ? String(rawOptions.pack) : undefined,
        packageName: rawOptions.package ? String(rawOptions.package) : undefined,
        format: parseAdoptFormat(String(rawOptions.format ?? "terminal")),
        writeConfig: rawOptions.writeConfig === true,
        force: rawOptions.force === true,
        writeBaseline: rawOptions.writeBaseline as boolean | string | undefined,
        cliOptions: {
          cwd,
          include: parseCommaList(rawOptions.include as string | undefined),
          exclude: parseCommaList(rawOptions.exclude as string | undefined),
          rules: parseRuleList(rawOptions.rules as string | undefined),
          thresholds: parseThresholds(rawOptions.threshold as string | undefined),
          pack: rawOptions.pack ? String(rawOptions.pack) : undefined,
          minSeverity: parseSeverity(String(rawOptions.minSeverity ?? "low"), "low"),
        },
      });

      process.stdout.write(report.text);
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

function parseOptionalInteger(value: string | boolean): number | true {
  if (value === true) return true;
  return parseInteger(String(value));
}

function normalizeOptionalLimit(value: unknown, defaultValue: number): number | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) return defaultValue;
  return value as number;
}

function parseConfidence(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Expected a confidence between 0 and 1, received "${value}".`);
  }
  return parsed;
}

interface PluginContribution {
  detectors?: Detector[];
  thresholds?: ScanThresholds;
  vocabulary?: Record<string, string[]>;
}

async function loadConfiguredPlugins(
  cwd: string,
  rawOptions: Record<string, unknown>,
  fileConfig: DebtLensConfig,
): Promise<PluginContribution | undefined> {
  if (!fileConfig.plugins?.length) return undefined;

  const configPath = findConfigPath(cwd, rawOptions.config ? String(rawOptions.config) : undefined);
  const configDir = configPath ? dirname(configPath) : cwd;
  const loaded = await loadPlugins(configDir, fileConfig, new Set(detectorIds));
  for (const warning of loaded.warnings) {
    process.stderr.write(`DebtLens: ${warning}\n`);
  }
  return {
    detectors: loaded.detectors.length > 0 ? loaded.detectors : undefined,
    thresholds: Object.keys(loaded.thresholds).length > 0 ? loaded.thresholds : undefined,
    vocabulary: Object.keys(loaded.vocabulary).length > 0 ? loaded.vocabulary : undefined,
  };
}

function resolveFailOn(
  rawOptions: Record<string, unknown>,
  fileConfig: DebtLensConfig,
): Severity | undefined {
  if (rawOptions.failOn) {
    return parseSeverity(String(rawOptions.failOn), "high");
  }
  if (fileConfig.failOn !== undefined) {
    return parseSeverity(String(fileConfig.failOn), "high");
  }
  return undefined;
}

function resolveFailOnConfidence(
  rawOptions: Record<string, unknown>,
  fileConfig: DebtLensConfig,
): number | undefined {
  if (rawOptions.failOnConfidence !== undefined) {
    return parseConfidence(String(rawOptions.failOnConfidence));
  }
  return fileConfig.failOnConfidence;
}

function shouldFailOnIssue(issue: DebtIssue, failOn: Severity, failOnConfidence: number | undefined): boolean {
  if (severityRank[issue.severity] < severityRank[failOn]) return false;
  if (failOnConfidence === undefined) return true;
  return issue.confidence >= failOnConfidence;
}

function shouldFailOnRegression(result: ScanResult): boolean {
  const delta = result.summary.deltaFromBaseline;
  if (!delta) return false;
  if (delta.totalDelta > 0) return true;
  if (delta.severityRegressions > 0) return true;
  if (!delta.hasBaselineSummary) return false;
  return Object.values(delta.byRule).some((ruleDelta) => ruleDelta.delta > 0);
}

function enrichIssuesWithBlameAge(cwd: string, options: ScanOptions, result: ScanResult): void {
  if (options.fileContents) return;

  let warnedNotGit = false;
  for (const issue of result.issues) {
    const line = issue.location?.startLine;
    if (line === undefined) continue;
    const issuePath = resolve(options.target, issue.file);
    const introducedDaysAgo = getLineIntroducedDaysAgo(cwd, issuePath, line);
    if (introducedDaysAgo === null) {
      if (!warnedNotGit) {
        process.stderr.write("DebtLens: --blame-age ignored (not a git repository).\n");
        warnedNotGit = true;
      }
      return;
    }
    if (introducedDaysAgo !== undefined) {
      issue.introducedDaysAgo = introducedDaysAgo;
    }
  }
}

function parseFormat(value: string): OutputFormat {
  if (value === "terminal" || value === "json" || value === "markdown" || value === "pr-comment" || value === "sarif" || value === "html" || value === "junit") return value;
  throw new Error(`Invalid format "${value}". Expected terminal, json, markdown, pr-comment, sarif, html, or junit.`);
}

function parseGroupBy(value: string): TerminalGroupBy {
  if (value === "severity" || value === "rule" || value === "file") return value;
  throw new Error(`Invalid group "${value}". Expected severity, rule, or file.`);
}

function parseAdoptFormat(value: string): "terminal" | "markdown" {
  if (value === "terminal" || value === "markdown") return value;
  throw new Error(`Invalid adopt format "${value}". Expected terminal or markdown.`);
}

function getGitHubSourceUrlBase(env: NodeJS.ProcessEnv): string | undefined {
  const serverUrl = env.GITHUB_SERVER_URL;
  const repository = env.GITHUB_REPOSITORY;
  const sha = env.GITHUB_SHA;
  if (!serverUrl || !repository || !sha) return undefined;
  return `${serverUrl.replace(/\/+$/, "")}/${repository}/blob/${sha}`;
}

function parseRulesFormat(value: string): "terminal" | "json" {
  if (value === "terminal" || value === "json") return value;
  throw new Error(`Invalid rules format "${value}". Expected terminal or json.`);
}

function parseCompletionShell(value: string): CompletionShell {
  if (value === "bash" || value === "zsh" || value === "fish") return value;
  throw new Error(`Invalid completion shell "${value}". Expected bash, zsh, or fish.`);
}

function renderRulesTable(rules: Array<{ id: string; name: string; defaultSeverity: string; description: string }>): string {
  const idWidth = Math.max("Rule".length, ...rules.map((rule) => rule.id.length));
  const severityWidth = Math.max("Severity".length, ...rules.map((rule) => rule.defaultSeverity.length));
  const lines = [
    `${"Rule".padEnd(idWidth)}  ${"Severity".padEnd(severityWidth)}  Description`,
    `${"-".repeat(idWidth)}  ${"-".repeat(severityWidth)}  -----------`,
    ...rules.map((rule) => `${rule.id.padEnd(idWidth)}  ${rule.defaultSeverity.padEnd(severityWidth)}  ${rule.description}`),
  ];

  return `${lines.join("\n")}\n`;
}

function renderPacksTable(packs: Array<{ id: string; description: string; rules: string[] }>): string {
  const idWidth = Math.max("Pack".length, ...packs.map((pack) => pack.id.length));
  const lines = [
    `${"Pack".padEnd(idWidth)}  Rules  Description`,
    `${"-".repeat(idWidth)}  -----  -----------`,
    ...packs.map((pack) => `${pack.id.padEnd(idWidth)}  ${String(pack.rules.length).padEnd(5)}  ${pack.description}`),
  ];

  return `${lines.join("\n")}\n`;
}

async function resolveReportedIssues(
  result: ScanResult,
  context: {
    cwd: string;
    baselinePath?: string;
    diffBase?: string;
    scanOptions: ScanOptions;
  },
): Promise<ScanResult> {
  if (context.baselinePath) {
    return applyBaseline(result, loadBaseline(context.cwd, context.baselinePath));
  }

  if (!context.diffBase) return result;

  const snapshot = getRefSnapshot(context.cwd, context.diffBase);
  if (!snapshot) {
    process.stderr.write("DebtLens: --diff-base ignored (not a git repository).\n");
    return result;
  }

  const baseResult = await scan({
    ...context.scanOptions,
    cwd: context.cwd,
    target: snapshot.root,
    changedFiles: snapshot.files,
    fileContents: snapshot.contents,
  });
  return applyBaseline(result, createBaseline(baseResult.issues));
}

function formatProfileReport(ruleTimingsMs: Record<string, number>): string {
  const lines = ["DebtLens profile (per-rule ms):"];
  for (const [ruleId, elapsedMs] of Object.entries(ruleTimingsMs).sort((left, right) => right[1] - left[1])) {
    lines.push(`  ${ruleId}: ${elapsedMs}ms`);
  }
  return `${lines.join("\n")}\n`;
}
