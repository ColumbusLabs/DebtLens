import type { Command } from "commander";
import { runExplain } from "../explain.js";

export function registerExplainCommand(program: Command): void {
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
}
