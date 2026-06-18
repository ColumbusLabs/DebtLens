import type { Command } from "commander";
import { runSuppress } from "../suppress.js";

export function registerSuppressCommand(program: Command): void {
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
}
