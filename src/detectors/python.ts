import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../core/types.js";
import { buildDuplicateLogicCandidatePairs } from "./duplicateLogic.js";
import { resolveTodoCommentPatterns } from "./todoComment.js";
import { createIssue } from "../utils/createIssue.js";
import { jaccard, shingle } from "../utils/similarity.js";

interface PythonFunction {
  name: string;
  params: string[];
  file: SourceFileInfo;
  startLine: number;
  endLine: number;
  text: string;
  bodyLines: string[];
}

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

export const pythonTodoCommentDetector: Detector = {
  id: "python-todo-comment",
  name: "Python debt marker comment",
  description: "Finds TODO/FIXME-style debt markers in Python comments.",
  defaultSeverity: "low",
  tags: ["python", "comments", "cleanup"],
  languages: ["python"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const patterns = resolveTodoCommentPatterns(context);

    for (const file of context.files) {
      const lines = file.content.split(/\r?\n/);
      let countForFile = 0;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const commentIndex = line.indexOf("#");
        if (commentIndex < 0) continue;
        const comment = line.slice(commentIndex);
        if (/debtlens-disable-(?:next-line|file)/i.test(comment)) continue;
        const match = patterns.find((pattern) => pattern.regex.test(comment));
        if (!match) continue;
        const hasTrackerLink = containsTrackerLink(comment);

        issues.push(createIssue({
          detector: pythonTodoCommentDetector,
          severity: match.severity,
          confidence: hasTrackerLink ? 0.96 : 0.9,
          file: file.relativePath,
          location: { startLine: index + 1 },
          message: `Python comment contains a ${match.label}.`,
          evidence: [
            comment.trim().slice(0, 220),
            ...(hasTrackerLink ? ["Tracker-linked marker detected"] : []),
          ],
          suggestion: "Convert the marker into a tracked issue, add a removal condition, or fix it before more code depends on it.",
        }));

        countForFile += 1;
        if (countForFile >= 12) break;
      }
    }

    return issues;
  },
};

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
      for (const fn of extractPythonFunctions(file)) {
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

export const pythonDeadAbstractionDetector: Detector = {
  id: "python-dead-abstraction",
  name: "Python dead abstraction",
  description: "Flags Python functions that only pass parameters through to another function.",
  defaultSeverity: "low",
  tags: ["python", "abstraction", "cleanup"],
  languages: ["python"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxWrapperLines = context.getThreshold("dead-abstraction.maxWrapperLines", 8);

    for (const file of context.files) {
      for (const fn of extractPythonFunctions(file)) {
        const lines = fn.endLine - fn.startLine + 1;
        if (lines > maxWrapperLines) continue;
        const wrapper = describePythonWrapper(fn);
        if (!wrapper) continue;

        issues.push(createIssue({
          detector: pythonDeadAbstractionDetector,
          severity: "low",
          confidence: wrapper.confidence,
          file: file.relativePath,
          location: { startLine: fn.startLine, endLine: fn.endLine },
          message: `${fn.name} looks like a thin Python wrapper: ${wrapper.description}.`,
          evidence: [fn.text.replace(/\s+/g, " ").slice(0, 180)],
          suggestion: "Keep the wrapper only if it creates a stable domain boundary. Otherwise inline it or add the missing behavior where this abstraction belongs.",
        }));
      }
    }

    return issues;
  },
};

function extractPythonFunctions(file: SourceFileInfo): PythonFunction[] {
  const lines = file.content.split(/\r?\n/);
  const functions: PythonFunction[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(/^(\s*)def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/);
    if (!match) continue;

    const indent = match[1]?.length ?? 0;
    const startLine = index + 1;
    let endIndex = index;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor] ?? "";
      if (candidate.trim() && indentation(candidate) <= indent) break;
      endIndex = cursor;
    }

    const textLines = lines.slice(index, endIndex + 1);
    functions.push({
      name: match[2] ?? "<anonymous>",
      params: parsePythonParams(match[3] ?? ""),
      file,
      startLine,
      endLine: endIndex + 1,
      text: textLines.join("\n"),
      bodyLines: textLines.slice(1),
    });
  }

  return functions;
}

function parsePythonParams(raw: string): string[] {
  return raw
    .split(",")
    .map((param) => param.trim().replace(/:.+$/, "").replace(/=.+$/, "").trim())
    .filter(Boolean)
    .map((param) => param.replace(/^\*+/, ""));
}

function describePythonWrapper(fn: PythonFunction): { description: string; confidence: number } | undefined {
  const significant = fn.bodyLines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (significant.length !== 1) return undefined;

  const line = significant[0] ?? "";
  const match = line.match(/^(?:return\s+)?([A-Za-z_][\w.]*)\((.*)\)$/);
  if (!match) return undefined;
  const callee = match[1] ?? "";
  const args = splitPythonArgs(match[2] ?? "");
  const params = fn.params[0] === "self" ? fn.params.slice(1) : fn.params;
  if (args.length !== params.length || !args.every((arg, index) => arg === params[index])) return undefined;
  return { description: `it only delegates to ${callee}(...)`, confidence: 0.8 };
}

function splitPythonArgs(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw.split(",").map((arg) => arg.trim()).filter(Boolean);
}

function normalizePythonSnippet(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => stripPythonComment(line))
    .join("\n")
    .replace(/("""|''')[\s\S]*?\1/g, " STR ")
    .replace(/(["'])(?:\\.|(?!\1).)*\1/g, " STR ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " NUM ")
    .replace(/\b[A-Za-z_]\w*\b/g, (token) => pythonKeywords.has(token) ? token : "ID")
    .replace(/\s+/g, " ")
    .trim();
}

function stripPythonComment(line: string): string {
  const index = line.indexOf("#");
  return index >= 0 ? line.slice(0, index) : line;
}

function fingerprintPython(normalized: string): Map<string, number> {
  const fingerprint = new Map<string, number>();
  for (const token of normalized.match(/[A-Za-z_]+|[()[\]{}:,.=+\-*/<>]/g) ?? []) {
    fingerprint.set(token, (fingerprint.get(token) ?? 0) + 1);
  }
  return fingerprint;
}

function indentation(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function containsTrackerLink(line: string): boolean {
  return /\b[A-Z][A-Z0-9]+-\d+\b/.test(line)
    || /\b(?:issue|ticket|bug|gh|github)\s*#?\d+\b/i.test(line)
    || /(?:^|[\s([#])#\d+\b/.test(line)
    || /https?:\/\/\S+\b(?:issues|browse|tickets?)\/\d+\b/i.test(line);
}

const pythonKeywords = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);
