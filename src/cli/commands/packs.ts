import type { Command } from "commander";
import { listRulePacks } from "../../config/packs.js";
import { parseRulesFormat, renderPacksTable } from "../parse.js";

export function registerPacksCommand(program: Command): void {
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
}
