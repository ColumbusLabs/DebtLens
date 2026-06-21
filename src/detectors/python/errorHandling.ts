import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";

const MAX_FINDINGS_PER_FILE = 12;

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
      const lines = file.content.split(/\r?\n/);
      const codeLines = maskPythonStringsAndComments(file.content).split(/\r?\n/);

      for (let index = 0; index < codeLines.length; index += 1) {
        const line = codeLines[index] ?? "";
        if (!/^\s*try\s*:/.test(line)) continue;

        const exceptBlocks = findPythonExceptBlocks(lines, codeLines, index);
        for (const exceptBlock of exceptBlocks) {
          const reason = classifyPythonExcept(exceptBlock.typePart, exceptBlock.bodyCodeLines);
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
  bodyCodeLines: string[];
  headerText: string;
}

function findPythonExceptBlocks(lines: string[], codeLines: string[], tryLineIndex: number): PythonExceptBlock[] {
  const tryIndent = indentation(lines[tryLineIndex] ?? "");
  const blocks: PythonExceptBlock[] = [];
  let index = tryLineIndex + 1;

  while (index < lines.length) {
    const line = codeLines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (indentation(line) <= tryIndent) break;
    index += 1;
  }

  while (index < lines.length) {
    const line = codeLines[index] ?? "";
    const trimmed = line.trim();
    const lineIndent = indentation(line);

    if (lineIndent < tryIndent) break;
    if (lineIndent > tryIndent) {
      index += 1;
      continue;
    }

    if (/^finally\s*:/.test(trimmed)) break;
    if (/^else\s*:/.test(trimmed)) {
      index = skipPythonBlock(codeLines, index, lineIndent);
      continue;
    }
    if (!/^except\b/.test(trimmed)) break;

    const header = parsePythonExceptHeader(lines, codeLines, index, tryIndent);
    if (!header) break;

    const bodyLines = header.inlineBody !== undefined
      ? [header.inlineBody]
      : collectPythonBlockBody(lines, header.endIndex, indentation(lines[header.endIndex] ?? ""));
    const bodyCodeLines = header.inlineBodyCode !== undefined
      ? [header.inlineBodyCode]
      : collectPythonBlockBody(codeLines, header.endIndex, indentation(codeLines[header.endIndex] ?? ""));

    blocks.push({
      exceptLine: index + 1,
      endLine: bodyLines.length > 0 && header.inlineBody === undefined
        ? header.endIndex + bodyLines.length
        : header.endIndex + 1,
      typePart: header.typePart,
      bodyLines,
      bodyCodeLines,
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
  codeLines: string[],
  startIndex: number,
  blockIndent: number,
): {
  endIndex: number;
  typePart: string | undefined;
  inlineBody: string | undefined;
  inlineBodyCode: string | undefined;
  headerText: string;
} | undefined {
  const headerParts: string[] = [];
  const headerCodeParts: string[] = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const code = codeLines[index] ?? "";
    const lineIndent = indentation(raw);
    if (index > startIndex && lineIndent < blockIndent) return undefined;
    if (index > startIndex && lineIndent > blockIndent) return undefined;

    headerParts.push(raw.trim());
    headerCodeParts.push(code.trim());
    const combined = headerCodeParts.join(" ");
    const colonIndex = code.indexOf(":");
    if (colonIndex < 0) continue;

    const headerMatch = combined.match(/^except(?:\s+([\s\S]+?))?\s*:/);
    if (!headerMatch) return undefined;

    const inlineBody = raw.slice(colonIndex + 1).trim();
    const inlineBodyCode = code.slice(colonIndex + 1).trim();
    return {
      endIndex: index,
      typePart: headerMatch[1]?.trim() || undefined,
      inlineBody: inlineBody || undefined,
      inlineBodyCode: inlineBodyCode || undefined,
      headerText: headerParts.join(" "),
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

  if (isPassOrCommentOnlyExcept(significant)) return "pass-or-comment";
  if (isBareOrBroadException(typePart) && isLogOnlyPythonBody(significant)) return "broad-log-only";
  return undefined;
}

function isPassOrCommentOnlyExcept(significant: string[]): boolean {
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
    .map((line) => line.trim())
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

function maskPythonStringsAndComments(content: string): string {
  const chars = [...content];
  let index = 0;

  while (index < content.length) {
    const char = content[index] ?? "";
    if (char === "#") {
      const start = index;
      while (index < content.length && content[index] !== "\n") index += 1;
      maskRange(chars, start, index);
      continue;
    }

    if (char === "\"" || char === "'") {
      const start = index;
      const quote = char;
      const triple = content.slice(index, index + 3) === quote.repeat(3);
      index += triple ? 3 : 1;

      while (index < content.length) {
        if (triple && content.slice(index, index + 3) === quote.repeat(3)) {
          index += 3;
          break;
        }
        if (!triple && content[index] === "\\" && index + 1 < content.length) {
          index += 2;
          continue;
        }
        if (!triple && content[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }

      maskRange(chars, start, index);
      continue;
    }

    index += 1;
  }

  return chars.join("");
}

function maskRange(chars: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (chars[index] !== "\n") chars[index] = " ";
  }
}

function indentation(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}
