import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";

const MAX_FINDINGS_PER_FILE = 12;
const disableNextLinePattern = /debtlens-disable-next-line\s+([a-z0-9-]+)(?:\s+--\s+(.+))?/i;
const disableFilePattern = /debtlens-disable-file\s+([a-z0-9-]+)(?:\s+--\s+(.+))?/i;

export const pythonErrorHandlingDetector: Detector = {
  id: "python-error-handling",
  name: "Python error handling smell",
  description: "Flags except blocks that silently ignore errors or only log broad Exception handlers.",
  defaultSeverity: "medium",
  tags: ["python", "error-handling", "maintainability", "review"],
  languages: ["python"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      let countForFile = 0;
      const suppressedRules = parseFileSuppressions(file.content);
      const lines = file.content.split(/\r?\n/);

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (!/^\s*try\s*:/.test(stripPythonComment(line))) continue;

        const exceptBlocks = findPythonExceptBlocks(lines, index);
        for (const exceptBlock of exceptBlocks) {
          if (isSuppressed(suppressedRules, pythonErrorHandlingDetector.id, exceptBlock.exceptLine)) continue;

          const reason = classifyPythonExcept(exceptBlock.typePart, exceptBlock.bodyLines);
          if (!reason) continue;

          issues.push(createPythonErrorHandlingIssue(file.relativePath, exceptBlock, reason));
          countForFile += 1;
          if (countForFile >= MAX_FINDINGS_PER_FILE) break;
        }

        if (countForFile >= MAX_FINDINGS_PER_FILE) break;
      }
    }

    return issues;
  },
};

type PythonExceptReason = "pass-or-comment" | "broad-log-only";

interface PythonExceptBlock {
  exceptLine: number;
  endLine: number;
  typePart: string | undefined;
  bodyLines: string[];
  headerText: string;
}

interface FileSuppressionRules {
  fileRules: Set<string>;
  nextLineRules: Map<number, Set<string>>;
  inlineLineRules: Map<number, Set<string>>;
}

function findPythonExceptBlocks(lines: string[], tryLineIndex: number): PythonExceptBlock[] {
  const tryIndent = indentation(lines[tryLineIndex] ?? "");
  const blocks: PythonExceptBlock[] = [];
  let index = tryLineIndex + 1;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (indentation(line) <= tryIndent) break;
    index += 1;
  }

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = stripPythonComment(line).trim();
    const lineIndent = indentation(line);

    if (lineIndent < tryIndent) break;
    if (lineIndent > tryIndent) {
      index += 1;
      continue;
    }

    if (/^finally\s*:/.test(trimmed)) break;
    if (/^else\s*:/.test(trimmed)) {
      index = skipPythonBlock(lines, index, lineIndent);
      continue;
    }
    if (!/^except\b/.test(trimmed)) break;

    const header = parsePythonExceptHeader(lines, index, tryIndent);
    if (!header) break;

    const bodyLines = header.inlineBody !== undefined
      ? [header.inlineBody]
      : collectPythonBlockBody(lines, header.endIndex, indentation(lines[header.endIndex] ?? ""));

    blocks.push({
      exceptLine: index + 1,
      endLine: bodyLines.length > 0 && header.inlineBody === undefined
        ? header.endIndex + bodyLines.length
        : header.endIndex + 1,
      typePart: header.typePart,
      bodyLines,
      headerText: header.headerText,
    });

    index = header.endIndex + 1;
    if (header.inlineBody === undefined) {
      index += bodyLines.length;
    }
  }

  return blocks;
}

function parsePythonExceptHeader(
  lines: string[],
  startIndex: number,
  blockIndent: number,
): { endIndex: number; typePart: string | undefined; inlineBody: string | undefined; headerText: string } | undefined {
  const headerParts: string[] = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const lineIndent = indentation(raw);
    if (index > startIndex && lineIndent < blockIndent) return undefined;
    if (index > startIndex && lineIndent > blockIndent) return undefined;

    const code = stripPythonComment(raw);
    headerParts.push(code.trim());
    const combined = headerParts.join(" ");
    const colonIndex = code.indexOf(":");
    if (colonIndex < 0) continue;

    const headerMatch = combined.match(/^except(?:\s+([\s\S]+?))?\s*:/);
    if (!headerMatch) return undefined;

    const inlineBody = code.slice(colonIndex + 1).trim();
    return {
      endIndex: index,
      typePart: headerMatch[1]?.trim() || undefined,
      inlineBody: inlineBody || undefined,
      headerText: combined,
    };
  }

  return undefined;
}

function collectPythonBlockBody(lines: string[], headerIndex: number, headerIndent: number): string[] {
  const bodyLines: string[] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      bodyLines.push(line);
      continue;
    }
    if (indentation(line) <= headerIndent) break;
    bodyLines.push(line);
  }
  return bodyLines;
}

function skipPythonBlock(lines: string[], startIndex: number, blockIndent: number): number {
  let index = startIndex + 1;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (indentation(line) <= blockIndent) break;
    index += 1;
  }
  return index;
}

function classifyPythonExcept(typePart: string | undefined, bodyLines: string[]): PythonExceptReason | undefined {
  const significant = getSignificantPythonLines(bodyLines);
  if (significant.some((line) => /^raise\b/.test(line))) return undefined;

  if (isPassOrCommentOnlyExcept(significant, bodyLines)) return "pass-or-comment";
  if (isBareOrBroadException(typePart) && isLogOnlyPythonBody(significant)) return "broad-log-only";
  return undefined;
}

function isPassOrCommentOnlyExcept(significant: string[], bodyLines: string[]): boolean {
  if (significant.length === 0) return true;
  return significant.length === 1 && significant[0] === "pass";
}

function isBareOrBroadException(typePart: string | undefined): boolean {
  if (!typePart) return true;

  const withoutAlias = typePart.split(/\s+as\s+/i)[0]?.trim() ?? "";
  if (withoutAlias.startsWith("(")) {
    const inner = withoutAlias.slice(1, -1);
    const types = inner.split(",").map((entry) => entry.trim()).filter(Boolean);
    return types.length === 0 || types.every((entry) => entry === "Exception");
  }

  return withoutAlias === "Exception";
}

function isLogOnlyPythonBody(significant: string[]): boolean {
  if (significant.length === 0) return false;
  return significant.every(isLogOnlyPythonStatement);
}

function isLogOnlyPythonStatement(line: string): boolean {
  if (line === "pass") return true;
  if (/^print\s*\(/.test(line)) return true;
  if (/^logging\.(?:debug|info|warning|error|exception|critical)\s*\(/.test(line)) return true;
  if (/^logger\.(?:debug|info|warning|error|exception|critical)\s*\(/.test(line)) return true;
  return /^[A-Za-z_][\w.]*\.(?:debug|info|warning|error|exception|critical)\s*\(/.test(line);
}

function getSignificantPythonLines(bodyLines: string[]): string[] {
  return bodyLines
    .map((line) => stripPythonComment(line).trim())
    .filter((line) => line.length > 0);
}

function createPythonErrorHandlingIssue(
  file: string,
  exceptBlock: PythonExceptBlock,
  reason: PythonExceptReason,
): DebtIssue {
  const message = reason === "pass-or-comment"
    ? "Except block only uses pass or comments and silently ignores errors."
    : "Bare except or broad Exception handler only logs the error without rethrowing or handling it.";

  const bodyPreview = exceptBlock.bodyLines.join("\n").trim().slice(0, 220) || exceptBlock.headerText.slice(0, 220);

  return createIssue({
    detector: pythonErrorHandlingDetector,
    severity: "medium",
    confidence: reason === "pass-or-comment" ? 0.88 : 0.74,
    file,
    location: { startLine: exceptBlock.exceptLine, endLine: exceptBlock.endLine },
    message,
    evidence: [
      `Except header: ${exceptBlock.headerText.slice(0, 180)}`,
      `Except body: ${bodyPreview}`,
    ],
    suggestion: "Handle the error explicitly, rethrow it, or document why ignoring it is safe.",
  });
}

function parseFileSuppressions(content: string): FileSuppressionRules {
  const fileRules = new Set<string>();
  const nextLineRules = new Map<number, Set<string>>();
  const inlineLineRules = new Map<number, Set<string>>();
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;

    const fileMatch = line.match(disableFilePattern);
    if (fileMatch?.[1] && fileMatch[2]?.trim()) {
      fileRules.add(fileMatch[1].toLowerCase());
      inlineLineRules.set(lineNumber, addRule(inlineLineRules.get(lineNumber), fileMatch[1]));
      continue;
    }

    const nextLineMatch = line.match(disableNextLinePattern);
    if (!nextLineMatch?.[1] || !nextLineMatch[2]?.trim()) continue;

    const ruleId = nextLineMatch[1].toLowerCase();
    inlineLineRules.set(lineNumber, addRule(inlineLineRules.get(lineNumber), ruleId));
    nextLineRules.set(lineNumber + 1, addRule(nextLineRules.get(lineNumber + 1), ruleId));
  }

  return { fileRules, nextLineRules, inlineLineRules };
}

function addRule(existing: Set<string> | undefined, ruleId: string): Set<string> {
  const rules = existing ?? new Set<string>();
  rules.add(ruleId.toLowerCase());
  return rules;
}

function isSuppressed(rules: FileSuppressionRules, ruleId: string, line: number): boolean {
  const normalizedRuleId = ruleId.toLowerCase();
  if (rules.fileRules.has(normalizedRuleId)) return true;
  if (rules.nextLineRules.get(line)?.has(normalizedRuleId)) return true;
  if (rules.inlineLineRules.get(line)?.has(normalizedRuleId)) return true;
  return false;
}

function stripPythonComment(line: string): string {
  const index = line.indexOf("#");
  return index >= 0 ? line.slice(0, index) : line;
}

function indentation(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}
