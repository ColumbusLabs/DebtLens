import type { Command } from "commander";
import { resolve } from "node:path";
import { runTriage } from "../triage.js";

export function registerTriageCommand(program: Command): void {
  program.command("triage")
    .description("Interactively triage scan findings into keep, baseline, or suppress actions.")
    .argument("[target]", "directory or file to scan", ".")
    .option("--cwd <path>", "working directory", process.cwd())
    .option("--config <path>", "path to debtlens.config.json")
    .option("--baseline <path>", "baseline file to update", "debtlens-baseline.json")
    .option("--dry-run", "preview actions without writing baseline updates")
    .action(async (target: string, rawOptions: Record<string, unknown>) => {
      try {
        if (!process.stdin.isTTY) {
          throw new Error("debtlens triage requires an interactive terminal.");
        }
        const counts = await runTriage({
          target,
          cwd: resolve(String(rawOptions.cwd ?? process.cwd())),
          configPath: rawOptions.config ? String(rawOptions.config) : undefined,
          baselinePath: rawOptions.baseline ? String(rawOptions.baseline) : undefined,
          dryRun: rawOptions.dryRun === true,
          cliOptions: rawOptions,
        });
        process.stdout.write(`\nTriage complete: kept ${counts.kept}, baselined ${counts.baselined}, suppressions ${counts.suppressed}, skipped ${counts.skipped}.\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`DebtLens failed: ${message}\n`);
        process.exitCode = 1;
      }
    });
}
