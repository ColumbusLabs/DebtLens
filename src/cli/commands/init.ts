import type { Command } from "commander";
import { resolve } from "node:path";
import { RULE_PACK_IDS } from "../../config/packs.js";
import { runInit } from "../init.js";
import { suggestConfigFromEslint } from "../eslintMigration.js";

export function registerInitCommand(program: Command): void {
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
}
