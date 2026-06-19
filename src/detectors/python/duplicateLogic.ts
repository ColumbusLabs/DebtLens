import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { buildDuplicateLogicCandidatePairs } from "../duplicateLogic.js";
import { createIssue } from "../../utils/createIssue.js";
import { jaccard, shingle } from "../../utils/similarity.js";
import { extractPythonFunctions, fingerprintPython, normalizePythonSnippet } from "./parse.js";

interface PythonSnippet {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  lines: number;
  normalized: string;
  shingles: Set<string>;
  fingerprint: Map<string, number>;
}

export const pythonDuplicateLogicDetector: Detector = {
  id: "python-duplicate-logic",
  name: "Python duplicate logic",
  description: "Finds near-duplicate Python functions after comments, names, strings, and literals are normalized.",
  defaultSeverity: "medium",
  tags: ["python", "duplication", "maintainability"],
  languages: ["python"],
  detect(context: DetectorContext): DebtIssue[] {
    const minSimilarity = context.getThreshold("duplicate-logic.minSimilarity", 0.86);
    const minStructural = context.getThreshold("duplicate-logic.minStructuralSimilarity", 0.6);
    const minLines = context.getThreshold("duplicate-logic.minLines", 8);
    const maxSnippets = context.getThreshold("duplicate-logic.maxSnippets", 450);
    const snippets: PythonSnippet[] = [];

    for (const file of context.files) {
      for (const fn of extractPythonFunctions(file, { addWarning: context.addWarning })) {
        const lines = fn.endLine - fn.startLine + 1;
        if (lines < minLines || lines > 220) continue;
        const normalized = normalizePythonSnippet(fn.text);
        if (normalized.length < 60) continue;
        snippets.push({
          name: fn.name,
          file: file.relativePath,
          startLine: fn.startLine,
          endLine: fn.endLine,
          lines,
          normalized,
          shingles: shingle(normalized),
          fingerprint: fingerprintPython(normalized),
        });
      }
    }

    if (snippets.length > maxSnippets) {
      context.addWarning(`python-duplicate-logic inspected ${maxSnippets} of ${snippets.length} eligible snippets because duplicate-logic.maxSnippets is capped.`);
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
        detector: pythonDuplicateLogicDetector,
        severity: similarity > 0.93 ? "high" : "medium",
        confidence: similarity,
        file: a.file,
        location: { startLine: a.startLine, endLine: a.endLine },
        message: `${a.name} is ${Math.round(similarity * 100)}% structurally similar to ${b.name}.`,
        evidence: [
          `${a.file}:${a.startLine}-${a.endLine} (${a.lines} lines)`,
          `${b.file}:${b.startLine}-${b.endLine} (${b.lines} lines)`,
        ],
        suggestion: "Compare the two implementations. Extract shared behavior only if the variation is intentional and stable; otherwise delete the weaker duplicate.",
      }));

      if (issues.length >= 50) return issues;
    }

    return issues;
  },
};
