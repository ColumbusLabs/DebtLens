import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { collectFunctionLikes, getFunctionBody, structuralFingerprint } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";
import { cosineSimilarity, jaccard, normalizeSnippet, shingle } from "../utils/similarity.js";

interface Snippet {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  lines: number;
  normalized: string;
  shingles: Set<string>;
  fingerprint: Map<string, number>;
}

export const duplicateLogicDetector: Detector = {
  id: "duplicate-logic",
  name: "Duplicate logic",
  description: "Finds near-duplicate functions/components after comments, identifiers, strings, and literals are normalized.",
  defaultSeverity: "medium",
  tags: ["duplication", "maintainability", "review"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const minSimilarity = context.getThreshold("duplicate-logic.minSimilarity", 0.86);
    const minStructural = context.getThreshold("duplicate-logic.minStructuralSimilarity", 0.6);
    const minLines = context.getThreshold("duplicate-logic.minLines", 8);
    const maxSnippets = context.getThreshold("duplicate-logic.maxSnippets", 450);
    const snippets: Snippet[] = [];

    for (const file of context.files) {
      for (const fn of collectFunctionLikes(file)) {
        const body = getFunctionBody(fn.node) ?? fn.node;
        const span = nodeLineSpan(body);
        if (span.lines < minLines || span.lines > 220) continue;
        const text = body.getText();
        const normalized = normalizeSnippet(text);
        if (normalized.length < 80) continue;
        snippets.push({
          name: fn.name,
          file: file.relativePath,
          startLine: span.startLine,
          endLine: span.endLine,
          lines: span.lines,
          normalized,
          shingles: shingle(normalized),
          fingerprint: structuralFingerprint(body),
        });
      }
    }

    const limited = snippets.slice(0, maxSnippets);
    const seenPairs = new Set<string>();

    for (let i = 0; i < limited.length; i += 1) {
      for (let j = i + 1; j < limited.length; j += 1) {
        const a = limited[i];
        const b = limited[j];
        if (!a || !b) continue;
        if (a.file === b.file && Math.abs(a.startLine - b.startLine) < 4) continue;
        // Cheap structural pre-filter: reject pairs whose control-flow/call shape
        // differs before doing the more expensive text-shingle comparison.
        if (cosineSimilarity(a.fingerprint, b.fingerprint) < minStructural) continue;
        const similarity = jaccard(a.shingles, b.shingles);
        if (similarity < minSimilarity) continue;

        const key = [a.file, a.startLine, b.file, b.startLine].sort().join("|");
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);

        issues.push(createIssue({
          detector: duplicateLogicDetector,
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
    }

    return issues;
  },
};
