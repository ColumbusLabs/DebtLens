import type { OutputFormat, ScanResult } from "../core/types.js";
import { renderHtml } from "./htmlReporter.js";
import { renderJson } from "./jsonReporter.js";
import { renderJunit } from "./junitReporter.js";
import { renderMarkdown } from "./markdownReporter.js";
import { renderPrComment } from "./prCommentReporter.js";
import { renderSarif } from "./sarifReporter.js";
import { renderTerminal } from "./terminalReporter.js";

export interface RenderReportOptions {
  color?: boolean;
  quiet?: boolean;
  sourceUrlBase?: string;
  groupBy?: "severity" | "rule" | "file";
  sarifCompact?: boolean;
  markdownHeatmapLimit?: number;
  prCommentDeltaOnly?: boolean;
  prCommentMaxFindings?: number;
  prCommentMaxBytes?: number;
  prCommentArtifactLink?: string;
  previousResult?: ScanResult;
}

export function renderReport(result: ScanResult, format: OutputFormat, options: RenderReportOptions = {}): string {
  if (format === "json") return renderJson(result);
  if (format === "markdown") return renderMarkdown(result, { heatmapLimit: options.markdownHeatmapLimit });
  if (format === "pr-comment") {
    return renderPrComment(result, {
      sourceUrlBase: options.sourceUrlBase,
      deltaOnly: options.prCommentDeltaOnly,
      maxFindings: options.prCommentMaxFindings,
      maxBytes: options.prCommentMaxBytes,
      artifactLink: options.prCommentArtifactLink,
    });
  }
  if (format === "sarif") return renderSarif(result, { compact: options.sarifCompact });
  if (format === "html") return renderHtml(result);
  if (format === "junit") return renderJunit(result);
  if (format === "terminal") return renderTerminal(result, { color: options.color ?? true, quiet: options.quiet, groupBy: options.groupBy });
  throw new Error(`Invalid format "${format}". Expected terminal, json, markdown, pr-comment, sarif, html, or junit.`);
}
