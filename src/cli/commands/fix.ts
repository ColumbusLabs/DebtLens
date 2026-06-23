import type { Command } from "commander";
import { resolve } from "node:path";
import { loadEffectiveConfig } from "../../config/loadConfig.js";
import { mergeConfig } from "../../config/mergeConfig.js";
import { runFix } from "../fix.js";
import { parseCommaList, parseRuleList, parseThresholds } from "../parse.js";
import { parseSeverity } from "../../core/severity.js";
import { loadConfiguredPlugins } from "../scanPipeline.js";

export function registerFixCommand(program: Command): void {
  program.command("fix")
    .description("Apply a conservative allowlist of mechanical autofixes (dry-run by default).")
    .argument("[target]", "directory or file to scan", ".")
    .option("--rules <rules>", "comma-separated fixable rule ids (duplicated-literal, dead-abstraction)")
    .option("--fix", "write fixes to disk (default is dry-run)")
    .option("--cwd <path>", "working directory", process.cwd())
    .option("--config <path>", "path to debtlens.config.json")
    .action(async (target: string, rawOptions: Record<string, unknown>) => {
      try {
        const cwd = resolve(String(rawOptions.cwd ?? process.cwd()));
        const effectiveConfig = loadEffectiveConfig(cwd, rawOptions.config ? String(rawOptions.config) : undefined);
        const pluginContribution = await loadConfiguredPlugins(cwd, rawOptions, effectiveConfig.config, effectiveConfig.pluginConfigDir);
        const options = mergeConfig(target, effectiveConfig.config, {
          cwd,
          include: parseCommaList(rawOptions.include as string | undefined),
          exclude: parseCommaList(rawOptions.exclude as string | undefined),
          rules: parseRuleList(rawOptions.rules as string | undefined),
          thresholds: parseThresholds(rawOptions.threshold as string | undefined),
          minSeverity: parseSeverity(String(rawOptions.minSeverity ?? "low"), "low"),
          pluginDetectors: pluginContribution?.detectors,
        });
        const result = await runFix(options, {
          rules: parseRuleList(rawOptions.rules as string | undefined),
          dryRun: rawOptions.fix !== true,
        });
        if (result.diffs.length === 0) {
          process.stdout.write(result.dryRun ? "No fixable findings.\n" : "No fixes applied.\n");
          return;
        }
        process.stdout.write(`${result.dryRun ? "Dry-run" : "Applied"} ${result.filesTouched} file(s):\n`);
        for (const diff of result.diffs) process.stdout.write(`${diff}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`DebtLens failed: ${message}\n`);
        process.exitCode = 1;
      }
    });
}
