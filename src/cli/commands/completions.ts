import type { Command } from "commander";
import { renderCompletions } from "../completions.js";
import { parseCompletionShell } from "../parse.js";

export function registerCompletionsCommand(program: Command): void {
  program.command("completions")
    .description("Print shell completions for bash, zsh, or fish.")
    .argument("<shell>", "bash, zsh, or fish")
    .action((shell: string) => {
      try {
        process.stdout.write(renderCompletions(parseCompletionShell(shell)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`DebtLens failed: ${message}\n`);
        process.exitCode = 1;
      }
    });
}
