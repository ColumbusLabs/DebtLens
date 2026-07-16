import type { Command } from "commander";
import { resolve } from "node:path";
import { runCalibrate } from "../calibrate.js";
import { parseInteger } from "../parse.js";

export function registerCalibrateCommand(program: Command): void {
  program.command("calibrate")
    .description("Suggest percentile-based threshold overrides from the current codebase.")
    .argument("[target]", "directory or file to scan", ".")
    .option("--cwd <path>", "working directory", process.cwd())
    .option("--config <path>", "path to debtlens.config.json")
    .option("--pack <name>", "rule pack preset to scan with")
    .option("--rules <rules>", "comma-separated rule ids to run")
    .option("--threshold <thresholds>", "comma-separated key=value threshold overrides")
    .option("--percentile <count>", "percentile used for suggestions (50-99)", parseInteger)
    .option("--write", "merge suggested thresholds into debtlens.config.json")
    .action(async (target: string, rawOptions: Record<string, unknown>) => {
      try {
        const report = await runCalibrate({
          target,
          cwd: resolve(String(rawOptions.cwd ?? process.cwd())),
          configPath: rawOptions.config ? String(rawOptions.config) : undefined,
          percentile: rawOptions.percentile as number | undefined,
          write: rawOptions.write === true,
          cliOptions: rawOptions,
        });
        process.stdout.write(report);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`DebtLens failed: ${message}\n`);
        process.exitCode = 1;
      }
    });
}
