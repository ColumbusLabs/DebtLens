import type { SourceFileInfo } from "../../core/types.js";

export interface PythonFunction {
  name: string;
  params: string[];
  file: SourceFileInfo;
  startLine: number;
  endLine: number;
  text: string;
  bodyLines: string[];
}

const PYTHON_DEF_PATTERN = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/;

export function extractPythonFunctions(file: SourceFileInfo): PythonFunction[] {
  const lines = file.content.split(/\r?\n/);
  const functions: PythonFunction[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (isDecoratorLine(lines[index] ?? "")) continue;

    const line = lines[index] ?? "";
    const match = line.match(PYTHON_DEF_PATTERN);
    if (!match) continue;

    const indent = match[1]?.length ?? 0;
    const startLine = index + 1;
    let endIndex = index;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor] ?? "";
      if (isDecoratorLine(candidate)) continue;
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

export function parsePythonParams(raw: string): string[] {
  return raw
    .split(",")
    .map((param) => param.trim().replace(/:.+$/, "").replace(/=.+$/, "").trim())
    .filter(Boolean)
    .map((param) => param.replace(/^\*+/, ""));
}

export function splitPythonArgs(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw.split(",").map((arg) => arg.trim()).filter(Boolean);
}

export function normalizePythonSnippet(text: string): string {
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

export function fingerprintPython(normalized: string): Map<string, number> {
  const fingerprint = new Map<string, number>();
  for (const token of normalized.match(/[A-Za-z_]+|[()[\]{}:,.=+\-*/<>]/g) ?? []) {
    fingerprint.set(token, (fingerprint.get(token) ?? 0) + 1);
  }
  return fingerprint;
}

function isDecoratorLine(line: string): boolean {
  return /^\s*@/.test(line);
}

function stripPythonComment(line: string): string {
  const index = line.indexOf("#");
  return index >= 0 ? line.slice(0, index) : line;
}

function indentation(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
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
