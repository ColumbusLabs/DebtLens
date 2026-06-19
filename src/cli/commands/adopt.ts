import type { Command } from "commander";
import { resolve } from "node:path";
import { RULE_PACK_IDS } from "../../config/packs.js";
import { detectorIds } from "../../detectors/index.js";
import { parseSeverity } from "../../core/severity.js";
import { runAdopt } from "../adopt.js";
import { gatePresets, parseGatePreset } from "../../core/gatePresets.js";
import { parseAdoptFormat, parseCommaList, parseRuleList, parseThresholds } from "../parse.js";

export function registerAdoptCommand(program: Command): void {
  program.command("adopt")
    .description("Scan and print an adoption summary; optionally write config and baseline.")
    .argument("[target]", "directory or file to scan", ".")
    .option("-i, --include <patterns>", "comma-separated glob patterns to include")
    .option("-x, --exclude <patterns>", "comma-separated glob patterns to exclude")
    .option("--min-severity <severity>", "info, low, medium, or high")
    .option("--pack <pack>", `built-in rule pack preset (${RULE_PACK_IDS.join(", ")})`)
    .option("--rules <rules>", `comma-separated rule ids. Available: ${detectorIds.join(", ")}`)
    .option("--threshold <thresholds>", "comma-separated key=value threshold overrides")
    .option("--gate <preset>", `named quality gate preset (${gatePresets.join(", ")})`)
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
          gatePreset: rawOptions.gate ? parseGatePreset(String(rawOptions.gate)) : undefined,
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
            gatePreset: rawOptions.gate ? parseGatePreset(String(rawOptions.gate)) : undefined,
            minSeverity: rawOptions.minSeverity !== undefined
              ? parseSeverity(String(rawOptions.minSeverity), "low")
              : undefined,
          },
        });

        process.stdout.write(report.text);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`DebtLens failed: ${message}\n`);
        process.exitCode = 1;
      }
    });
}
