import type { Command } from "commander";
import { allDetectors } from "../../detectors/index.js";
import { parseRulesFormat, renderRulesTable } from "../parse.js";

export function registerRulesCommand(program: Command): void {
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
}
