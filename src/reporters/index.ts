import type { OutputFormat, ScanResult } from "../core/types.js";
import { renderJson } from "./jsonReporter.js";
import { renderMarkdown } from "./markdownReporter.js";
import { renderSarif } from "./sarifReporter.js";
import { renderTerminal } from "./terminalReporter.js";

export function renderReport(result: ScanResult, format: OutputFormat, options: { color?: boolean; quiet?: boolean } = {}): string {
  if (format === "json") return renderJson(result);
  if (format === "markdown") return renderMarkdown(result);
  if (format === "sarif") return renderSarif(result);
  return renderTerminal(result, { color: options.color ?? true, quiet: options.quiet });
}
