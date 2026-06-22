import type { Command } from "commander";
import { resolve } from "node:path";
import { renderHistoryReport, type HistoryFormat } from "../../reporters/historyReporter.js";
import { parseInteger } from "../parse.js";
import { runHistoryRecord, runHistoryShow } from "../history.js";

export function registerHistoryCommand(program: Command): void {
  const history = program.command("history")
    .description("Record and view maintainability debt trends over time.");

  history.command("record")
    .description("Scan and append a summary snapshot to the history ledger.")
    .argument("[target]", "directory or file to scan", ".")
    .option("--cwd <path>", "working directory", process.cwd())
    .option("--config <path>", "path to debtlens.config.json")
    .option("--history-path <path>", "history ledger path", ".debtlens/history.jsonl")
    .option("--once", "skip recording when the current git SHA already exists")
    .action(async (target: string, rawOptions: Record<string, unknown>) => {
      try {
        const { appended, path } = await runHistoryRecord({
          target,
          cwd: resolve(String(rawOptions.cwd ?? process.cwd())),
          configPath: rawOptions.config ? String(rawOptions.config) : undefined,
          historyPath: rawOptions.historyPath ? String(rawOptions.historyPath) : undefined,
          once: rawOptions.once === true,
          cliOptions: rawOptions,
        });
        process.stdout.write(`${appended ? "Recorded" : "Skipped"} history entry at ${path}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`DebtLens failed: ${message}\n`);
        process.exitCode = 1;
      }
    });

  history.command("show")
    .description("Render the history ledger as a timeline.")
    .option("--cwd <path>", "working directory", process.cwd())
    .option("--history-path <path>", "history ledger path", ".debtlens/history.jsonl")
    .option("--format <format>", "terminal, markdown, html, or json", "terminal")
    .option("--since <sha|date>", "only include entries since this git SHA prefix or ISO date")
    .option("--limit <count>", "limit to the most recent N entries", parseInteger)
    .action((rawOptions: Record<string, unknown>) => {
      try {
        const format = parseHistoryFormat(String(rawOptions.format ?? "terminal"));
        const entries = runHistoryShow(resolve(String(rawOptions.cwd ?? process.cwd())), {
          historyPath: rawOptions.historyPath ? String(rawOptions.historyPath) : undefined,
          since: rawOptions.since ? String(rawOptions.since) : undefined,
          limit: rawOptions.limit as number | undefined,
        });
        process.stdout.write(renderHistoryReport(entries, format));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`DebtLens failed: ${message}\n`);
        process.exitCode = 1;
      }
    });
}

function parseHistoryFormat(value: string): HistoryFormat {
  if (value === "terminal" || value === "markdown" || value === "html" || value === "json") return value;
  throw new Error(`Invalid history format "${value}". Expected terminal, markdown, html, or json.`);
}
