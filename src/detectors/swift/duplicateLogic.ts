import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { jaccard, shingle } from "../../utils/similarity.js";
import { buildDuplicateLogicCandidatePairs } from "../duplicateLogic.js";
import { extractSwiftFunctions, fingerprintSwift, normalizeSwiftSnippet } from "./parse.js";

interface SwiftSnippet {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  lines: number;
  normalized: string;
  shingles: Set<string>;
  fingerprint: Map<string, number>;
}

export const swiftDuplicateLogicDetector: Detector = {
  id: "swift-duplicate-logic",
  name: "Swift duplicate logic",
  description: "Finds near-duplicate Swift functions after comments, names, strings, and literals are normalized.",
  defaultSeverity: "medium",
  tags: ["swift", "duplication", "maintainability"],
  languages: ["swift"],
  detect(context: DetectorContext): DebtIssue[] {
    const minSimilarity = context.getThreshold("duplicate-logic.minSimilarity", 0.86);
    const minStructural = context.getThreshold("duplicate-logic.minStructuralSimilarity", 0.6);
    const minLines = context.getThreshold("duplicate-logic.minLines", 8);
    const maxSnippets = context.getThreshold("duplicate-logic.maxSnippets", 450);
    const snippets: SwiftSnippet[] = [];

    for (const file of context.files) {
      for (const fn of extractSwiftFunctions(file)) {
        if (fn.isViewBody || fn.attributes.some((attribute) => /@ViewBuilder\b/.test(attribute))) continue;
        const lines = fn.endLine - fn.startLine + 1;
        if (lines < minLines || lines > 240) continue;
        const normalized = normalizeSwiftSnippet(fn.text);
        if (normalized.length < 60) continue;
        snippets.push({
          name: fn.name,
          file: file.relativePath,
          startLine: fn.startLine,
          endLine: fn.endLine,
          lines,
          normalized,
          shingles: shingle(normalized),
          fingerprint: fingerprintSwift(normalized),
        });
      }
    }

    if (snippets.length > maxSnippets) {
      context.addWarning(`swift-duplicate-logic inspected ${maxSnippets} of ${snippets.length} eligible snippets because duplicate-logic.maxSnippets is capped.`);
    }

    const issues: DebtIssue[] = [];
    const limited = snippets.slice(0, maxSnippets);
    const candidatePairs = buildDuplicateLogicCandidatePairs(limited, minStructural);
    const seenPairs = new Set<string>();

    for (const { leftIndex, rightIndex } of candidatePairs) {
      const a = limited[leftIndex];
      const b = limited[rightIndex];
      if (!a || !b) continue;
      const similarity = jaccard(a.shingles, b.shingles);
      if (similarity < minSimilarity) continue;

      const key = [a.file, a.startLine, b.file, b.startLine].sort().join("|");
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);

      issues.push(createIssue({
        detector: swiftDuplicateLogicDetector,
        severity: similarity > 0.93 ? "high" : "medium",
        confidence: similarity,
        file: a.file,
        location: { startLine: a.startLine, endLine: a.endLine },
        message: `${a.name} is ${Math.round(similarity * 100)}% structurally similar to ${b.name}.`,
        evidence: [
          `${a.file}:${a.startLine}-${a.endLine} (${a.lines} lines)`,
          `${b.file}:${b.startLine}-${b.endLine} (${b.lines} lines)`,
        ],
        suggestion: "Compare the two Swift implementations. Extract shared behavior only if the variation is intentional and stable; otherwise delete the weaker duplicate.",
      }));

      if (issues.length >= 50) return issues;
    }

    return issues;
  },
};
