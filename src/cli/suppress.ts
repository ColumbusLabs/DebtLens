import { allDetectors } from "../detectors/index.js";
import { suggestClosest } from "../utils/didYouMean.js";

export interface SuppressOptions {
  ruleId: string;
  reason: string;
  /** When true, emit a file-level directive instead of next-line. */
  file?: boolean;
}

/**
 * Render a copy-paste inline suppression directive for `debtlens suppress`.
 * The output must stay parseable by src/core/suppressions.ts, including the
 * `-- reason` segment the scanner requires before honoring a suppression.
 */
export function runSuppress(options: SuppressOptions): string {
  const normalized = options.ruleId.toLowerCase();
  const detector = allDetectors.find((candidate) => candidate.id === normalized);
  if (!detector) {
    const suggestion = suggestClosest(normalized, allDetectors.map((candidate) => candidate.id));
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
    throw new Error(`Unknown DebtLens rule "${options.ruleId}".${hint} Run "debtlens rules" to list available rules.`);
  }

  const reason = options.reason.trim();
  if (!reason) {
    throw new Error("A non-empty --reason is required; DebtLens ignores suppressions without one.");
  }

  const directive = options.file ? "debtlens-disable-file" : "debtlens-disable-next-line";
  return `// ${directive} ${detector.id} -- ${reason}\n`;
}
