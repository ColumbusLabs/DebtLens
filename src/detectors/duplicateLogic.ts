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

export interface DuplicateLogicCandidateInput {
  file: string;
  startLine: number;
  fingerprint: Map<string, number>;
}

export interface DuplicateLogicCandidatePair {
  leftIndex: number;
  rightIndex: number;
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

    if (snippets.length > maxSnippets) {
      context.addWarning(`duplicate-logic inspected ${maxSnippets} of ${snippets.length} eligible snippets because duplicate-logic.maxSnippets is capped.`);
    }

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
        detector: duplicateLogicDetector,
        severity: similarity > 0.93 ? "high" : "medium",
        confidence: similarity,
        file: a.file,
        location: { startLine: a.startLine, endLine: a.endLine },
        message: `${formatSnippetLabel(a)} is ${Math.round(similarity * 100)}% structurally similar to ${formatSnippetLabel(b)}.`,
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

export function buildDuplicateLogicCandidatePairs(
  snippets: readonly DuplicateLogicCandidateInput[],
  minStructural: number,
): DuplicateLogicCandidatePair[] {
  if (snippets.length < 2) return [];

  if (minStructural <= 0) {
    return buildAllOrderedPairs(snippets);
  }

  const pairs: DuplicateLogicCandidatePair[] = [];
  const fingerprintNorms = snippets.map(({ fingerprint }) => fingerprintNorm(fingerprint));
  const snippetsByToken = new Map<string, Array<{ index: number; count: number }>>();
  const emptyFingerprintIndexes: number[] = [];

  for (let rightIndex = 0; rightIndex < snippets.length; rightIndex += 1) {
    const current = snippets[rightIndex];
    if (!current) continue;

    if (current.fingerprint.size === 0) {
      for (const leftIndex of emptyFingerprintIndexes) {
        const previous = snippets[leftIndex];
        if (!previous || isSameLocalSnippet(previous, current)) continue;
        if (minStructural <= 1) {
          pairs.push({ leftIndex, rightIndex });
        }
      }
    } else {
      const dotProductsByIndex = new Map<number, number>();

      for (const [token, count] of current.fingerprint) {
        const priorSnippets = snippetsByToken.get(token);
        if (!priorSnippets) continue;

        for (const prior of priorSnippets) {
          dotProductsByIndex.set(
            prior.index,
            (dotProductsByIndex.get(prior.index) ?? 0) + count * prior.count,
          );
        }
      }

      for (const [leftIndex, dotProduct] of dotProductsByIndex) {
        const previous = snippets[leftIndex];
        if (!previous || isSameLocalSnippet(previous, current)) continue;
        const leftNorm = fingerprintNorms[leftIndex] ?? 0;
        const rightNorm = fingerprintNorms[rightIndex] ?? 0;
        const structuralSimilarity = leftNorm === 0 || rightNorm === 0
          ? cosineSimilarity(previous.fingerprint, current.fingerprint)
          : dotProduct / (leftNorm * rightNorm);
        if (structuralSimilarity >= minStructural) {
          pairs.push({ leftIndex, rightIndex });
        }
      }
    }

    if (current.fingerprint.size === 0) {
      emptyFingerprintIndexes.push(rightIndex);
    } else {
      for (const [token, count] of current.fingerprint) {
        const bucket = snippetsByToken.get(token) ?? [];
        bucket.push({ index: rightIndex, count });
        snippetsByToken.set(token, bucket);
      }
    }
  }

  return pairs.sort((a, b) => a.leftIndex - b.leftIndex || a.rightIndex - b.rightIndex);
}

function buildAllOrderedPairs(snippets: readonly DuplicateLogicCandidateInput[]): DuplicateLogicCandidatePair[] {
  const pairs: DuplicateLogicCandidatePair[] = [];
  for (let leftIndex = 0; leftIndex < snippets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < snippets.length; rightIndex += 1) {
      const left = snippets[leftIndex];
      const right = snippets[rightIndex];
      if (!left || !right || isSameLocalSnippet(left, right)) continue;
      pairs.push({ leftIndex, rightIndex });
    }
  }
  return pairs;
}

function fingerprintNorm(fingerprint: Map<string, number>): number {
  let squared = 0;
  for (const count of fingerprint.values()) {
    squared += count * count;
  }
  return Math.sqrt(squared);
}

function isSameLocalSnippet(a: DuplicateLogicCandidateInput, b: DuplicateLogicCandidateInput): boolean {
  return a.file === b.file && Math.abs(a.startLine - b.startLine) < 4;
}

function formatSnippetLabel(snippet: Snippet): string {
  return `${snippet.name} (${snippet.file}:${snippet.startLine})`;
}
