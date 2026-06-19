import { readFileSync } from "node:fs";
import { defaultConfig } from "../config/defaults.js";
import { allDetectors } from "../detectors/index.js";
import { suggestClosest } from "../utils/didYouMean.js";

/**
 * Render rule documentation for `debtlens explain <rule>`: registry metadata,
 * default thresholds, and the matching section of docs/rules.md when available.
 */
export function runExplain(ruleId: string): string {
  const normalized = ruleId.toLowerCase();
  const detector = allDetectors.find((candidate) => candidate.id === normalized);
  if (!detector) {
    const suggestion = suggestClosest(normalized, allDetectors.map((candidate) => candidate.id));
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
    throw new Error(`Unknown DebtLens rule "${ruleId}".${hint} Run "debtlens rules" to list available rules.`);
  }

  const lines = [
    `${detector.name} [${detector.id}]`,
    "",
    detector.description,
    "",
    `Default severity: ${detector.defaultSeverity}`,
    `Tags: ${detector.tags.join(", ")}`,
  ];

  const thresholds = Object.entries(defaultConfig.thresholds)
    .filter(([key]) => key.startsWith(`${detector.id}.`));
  if (thresholds.length > 0) {
    lines.push("", "Default thresholds:");
    for (const [key, value] of thresholds) {
      lines.push(`  ${key}: ${value}`);
    }
  }

  const docsSection = readRuleDocsSection(detector.id);
  if (docsSection) {
    lines.push("", docsSection);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Extract the `## \`<rule-id>\`` or nested `### \`<rule-id>\`` section from docs/rules.md. The docs directory
 * is published with the npm package, two levels above this module in both the
 * src and dist layouts. Returns undefined when the docs are unavailable.
 */
function readRuleDocsSection(ruleId: string): string | undefined {
  let content: string;
  try {
    content = readFileSync(new URL("../../docs/rules.md", import.meta.url), "utf8");
  } catch {
    return undefined;
  }

  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => isRuleDocsHeading(line, ruleId));
  if (headingIndex === -1) return undefined;

  const headingLevel = headingDepth(lines[headingIndex] ?? "");
  let end = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const nextHeadingLevel = headingDepth(lines[index] ?? "");
    if (nextHeadingLevel > 0 && nextHeadingLevel <= headingLevel) {
      end = index;
      break;
    }
  }

  return lines.slice(headingIndex + 1, end).join("\n").trim();
}

function isRuleDocsHeading(line: string, ruleId: string): boolean {
  return /^#{2,3}\s+`[^`]+`\s*$/.test(line.trim()) && line.trim().endsWith(`\`${ruleId}\``);
}

function headingDepth(line: string): number {
  return /^(#+)\s+/.exec(line)?.[1]?.length ?? 0;
}
