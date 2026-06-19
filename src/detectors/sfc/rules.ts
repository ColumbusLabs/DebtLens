import type { DebtIssue, Detector, DetectorContext, SourceLanguage } from "../../core/types.js";
import { buildDuplicateLogicCandidatePairs } from "../duplicateLogic.js";
import { resolveTodoCommentPatterns } from "../todoComment.js";
import { collectFunctionLikes, countBranches, getFunctionBody, structuralFingerprint } from "../../utils/ast.js";
import { createIssue } from "../../utils/createIssue.js";
import { nodeLineSpan } from "../../utils/lines.js";
import { jaccard, normalizeSnippet, shingle } from "../../utils/similarity.js";
import { containsTrackerLink } from "../../utils/strings.js";
import { extractSfcScriptBlocks } from "../../utils/sfc.js";

interface SfcRuleOptions {
  language: Extract<SourceLanguage, "vue" | "svelte">;
  frameworkName: "Vue" | "Svelte";
}

interface SfcSnippet {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  lines: number;
  normalized: string;
  shingles: Set<string>;
  fingerprint: Map<string, number>;
}

export function createSfcTodoCommentDetector(options: SfcRuleOptions): Detector {
  const id = `${options.language}-todo-comment`;
  const detector: Detector = {
    id,
    name: `${options.frameworkName} script debt marker`,
    description: `Finds TODO/FIXME-style comments inside ${options.frameworkName} single-file component script blocks.`,
    defaultSeverity: "low",
    tags: [options.language, "comments", "sfc", "cleanup"],
    languages: [options.language],
    detect(context: DetectorContext): DebtIssue[] {
      const issues: DebtIssue[] = [];
      const patterns = resolveTodoCommentPatterns(context);

      for (const file of context.files) {
        let countForFile = 0;
        for (const block of extractSfcScriptBlocks(file.content)) {
          const lines = block.content.split(/\r?\n/);
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? "";
            if (!line.includes("//") && !line.includes("/*") && !line.includes("*")) continue;
            if (/debtlens-disable-(?:next-line|file)/i.test(line)) continue;
            const match = patterns.find((pattern) => pattern.regex.test(line));
            if (!match) continue;
            const hasTrackerLink = containsTrackerLink(line);
            issues.push(createIssue({
              detector,
              severity: match.severity,
              confidence: hasTrackerLink ? 0.96 : 0.9,
              file: file.relativePath,
              location: { startLine: block.startLine + index },
              message: `${options.frameworkName} script comment contains a ${match.label}.`,
              evidence: [
                line.trim().slice(0, 220),
                ...(hasTrackerLink ? ["Tracker-linked marker detected"] : []),
              ],
              suggestion: "Convert the marker into a tracked issue, add a removal condition, or remove it from the component script.",
            }));
            countForFile += 1;
            if (countForFile >= 12) break;
          }
          if (countForFile >= 12) break;
        }
      }

      return issues;
    },
  };
  return detector;
}

export function createSfcLargeScriptDetector(options: SfcRuleOptions): Detector {
  const id = `${options.language}-large-script`;
  const detector: Detector = {
    id,
    name: `${options.frameworkName} large script`,
    description: `Flags ${options.frameworkName} single-file component script blocks or script functions that exceed size and branch budgets.`,
    defaultSeverity: "medium",
    tags: [options.language, "sfc", "complexity", "script"],
    languages: [options.language],
    detect(context: DetectorContext): DebtIssue[] {
      const issues: DebtIssue[] = [];
      const maxLines = context.getThreshold(`${id}.maxLines`, 120);
      const maxFunctionLines = context.getThreshold(`${id}.maxFunctionLines`, 80);
      const maxBranches = context.getThreshold(`${id}.maxBranches`, 12);

      for (const file of context.files) {
        for (const block of extractSfcScriptBlocks(file.content)) {
          const lines = countMeaningfulLines(block.content);
          if (lines >= maxLines) {
            issues.push(createIssue({
              detector,
              severity: "medium",
              confidence: 0.82,
              file: file.relativePath,
              location: { startLine: block.startLine, endLine: block.endLine },
              message: `${file.relativePath} has a ${lines}-line ${options.frameworkName} script block.`,
              evidence: [`Script lines: ${lines} / ${maxLines}`],
              suggestion: "Move unrelated state, data loading, or helpers into named modules so the component script stays reviewable.",
            }));
          }
        }

        for (const fn of collectFunctionLikes(file)) {
          const body = getFunctionBody(fn.node);
          if (!body) continue;
          const span = nodeLineSpan(body);
          const branchCount = countBranches(body);
          const overLineBudget = span.lines >= maxFunctionLines;
          const overBranchBudget = branchCount >= maxBranches;
          if (!overLineBudget && !overBranchBudget) continue;
          issues.push(createIssue({
            detector,
            severity: overLineBudget && overBranchBudget ? "high" : "medium",
            confidence: overLineBudget ? 0.82 : 0.76,
            file: file.relativePath,
            location: { startLine: span.startLine, endLine: span.endLine },
            message: `${fn.name} in ${file.relativePath} is large enough to hide multiple ${options.frameworkName} responsibilities.`,
            evidence: [
              `Lines: ${span.lines} / ${maxFunctionLines}`,
              `Branch points: ${branchCount} / ${maxBranches}`,
            ],
            suggestion: "Split unrelated branches or phases into composables, stores, or named helpers.",
          }));
        }
      }

      return issues;
    },
  };
  return detector;
}

export function createSfcDuplicateLogicDetector(options: SfcRuleOptions): Detector {
  const id = `${options.language}-duplicate-logic`;
  const detector: Detector = {
    id,
    name: `${options.frameworkName} duplicate script logic`,
    description: `Finds near-duplicate functions inside ${options.frameworkName} single-file component script blocks.`,
    defaultSeverity: "medium",
    tags: [options.language, "sfc", "duplication", "maintainability"],
    languages: [options.language],
    detect(context: DetectorContext): DebtIssue[] {
      const minSimilarity = context.getThreshold("duplicate-logic.minSimilarity", 0.86);
      const minStructural = context.getThreshold("duplicate-logic.minStructuralSimilarity", 0.6);
      const minLines = context.getThreshold("duplicate-logic.minLines", 8);
      const maxSnippets = context.getThreshold("duplicate-logic.maxSnippets", 450);
      const snippets: SfcSnippet[] = [];

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
        context.addWarning(`${id} inspected ${maxSnippets} of ${snippets.length} eligible snippets because duplicate-logic.maxSnippets is capped.`);
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
          detector,
          severity: similarity > 0.93 ? "high" : "medium",
          confidence: similarity,
          file: a.file,
          location: { startLine: a.startLine, endLine: a.endLine },
          message: `${a.name} is ${Math.round(similarity * 100)}% structurally similar to ${b.name}.`,
          evidence: [
            `${a.file}:${a.startLine}-${a.endLine} (${a.lines} lines)`,
            `${b.file}:${b.startLine}-${b.endLine} (${b.lines} lines)`,
          ],
          suggestion: `Compare the two ${options.frameworkName} script implementations. Extract shared behavior only if the variation is intentional and stable.`,
        }));

        if (issues.length >= 50) return issues;
      }

      return issues;
    },
  };
  return detector;
}

function countMeaningfulLines(content: string): number {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*"))
    .length;
}

export const vueTodoCommentDetector = createSfcTodoCommentDetector({ language: "vue", frameworkName: "Vue" });
export const vueLargeScriptDetector = createSfcLargeScriptDetector({ language: "vue", frameworkName: "Vue" });
export const vueDuplicateLogicDetector = createSfcDuplicateLogicDetector({ language: "vue", frameworkName: "Vue" });

export const svelteTodoCommentDetector = createSfcTodoCommentDetector({ language: "svelte", frameworkName: "Svelte" });
export const svelteLargeScriptDetector = createSfcLargeScriptDetector({ language: "svelte", frameworkName: "Svelte" });
export const svelteDuplicateLogicDetector = createSfcDuplicateLogicDetector({ language: "svelte", frameworkName: "Svelte" });
