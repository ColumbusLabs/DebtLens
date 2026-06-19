import type { SourceFileInfo } from "../../core/types.js";
import {
  parsePythonAstSidecar,
  type PythonAstFunctionInfo,
  type PythonAstModuleInfo,
  type PythonClassInfo,
  type PythonCommentInfo,
  type PythonDecoratorInfo,
  type PythonImportInfo,
} from "./astSidecar.js";

export interface PythonFunction {
  name: string;
  qualifiedName?: string;
  params: string[];
  file: SourceFileInfo;
  startLine: number;
  endLine: number;
  text: string;
  bodyLines: string[];
  isAsync?: boolean;
  kind?: "function" | "method" | "nested-function";
  parentClass?: string;
  decorators?: PythonDecoratorInfo[];
  bodyStartLine?: number;
}

export interface PythonModuleInfo {
  functions: PythonFunction[];
  classes: PythonClassInfo[];
  imports: PythonImportInfo[];
  comments: PythonCommentInfo[];
  usedAstSidecar: boolean;
}

export interface PythonParseOptions {
  addWarning?: (warning: string) => void;
  pythonCommands?: readonly string[];
  preferAstSidecar?: boolean;
}

const PYTHON_DEF_START_PATTERN = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
const MAX_FUNCTION_HEADER_LINES = 20;

export function extractPythonModule(file: SourceFileInfo, options: PythonParseOptions = {}): PythonModuleInfo {
  if (options.preferAstSidecar !== false) {
    const moduleInfo = parsePythonAstSidecar(file, {
      addWarning: options.addWarning,
      pythonCommands: options.pythonCommands,
    });
    if (moduleInfo) {
      return {
        functions: moduleInfo.functions.map((fn) => pythonFunctionFromAst(file, fn)),
        classes: moduleInfo.classes,
        imports: moduleInfo.imports,
        comments: moduleInfo.comments,
        usedAstSidecar: true,
      };
    }
  }

  return {
    functions: extractPythonFunctionsWithHeuristics(file),
    classes: [],
    imports: [],
    comments: [],
    usedAstSidecar: false,
  };
}

export function extractPythonFunctions(file: SourceFileInfo, options: PythonParseOptions = {}): PythonFunction[] {
  return extractPythonModule(file, options).functions;
}

function extractPythonFunctionsWithHeuristics(file: SourceFileInfo): PythonFunction[] {
  const lines = file.content.split(/\r?\n/);
  const functions: PythonFunction[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (isDecoratorLine(lines[index] ?? "")) continue;

    const header = parsePythonFunctionHeader(lines, index);
    if (!header) continue;

    const { headerEndIndex, indent } = header;
    const startLine = index + 1;
    let endIndex = headerEndIndex;
    for (let cursor = headerEndIndex + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor] ?? "";
      if (isDecoratorLine(candidate)) continue;
      if (candidate.trim() && indentation(candidate) <= indent) break;
      endIndex = cursor;
    }

    const textLines = lines.slice(index, endIndex + 1);
    functions.push({
      name: header.name,
      params: parsePythonParams(header.params),
      file,
      startLine,
      endLine: endIndex + 1,
      text: textLines.join("\n"),
      bodyLines: lines.slice(headerEndIndex + 1, endIndex + 1),
    });
  }

  return functions;
}

function pythonFunctionFromAst(file: SourceFileInfo, fn: PythonAstFunctionInfo): PythonFunction {
  const lines = file.content.split(/\r?\n/);
  const startLine = Math.max(1, fn.startLine);
  const endLine = Math.max(startLine, fn.endLine);
  const bodyStartLine = fn.bodyStartLine && fn.bodyStartLine >= startLine
    ? fn.bodyStartLine
    : firstBodyLineFromText(lines, startLine, endLine);
  const text = lines.slice(startLine - 1, endLine).join("\n");
  return {
    name: fn.name,
    qualifiedName: fn.qualifiedName,
    params: fn.params,
    file,
    startLine,
    endLine,
    text,
    bodyLines: bodyStartLine ? lines.slice(bodyStartLine - 1, endLine) : [],
    isAsync: fn.isAsync,
    kind: fn.kind,
    parentClass: fn.parentClass,
    decorators: fn.decorators,
    bodyStartLine,
  };
}

function firstBodyLineFromText(lines: string[], startLine: number, endLine: number): number | undefined {
  for (let line = startLine; line <= endLine; line += 1) {
    const text = lines[line - 1] ?? "";
    if (!text.trim() || text.trim().startsWith("@")) continue;
    if (/^\s*(?:async\s+)?def\b/.test(text)) continue;
    return line;
  }
  return undefined;
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

function parsePythonFunctionHeader(
  lines: string[],
  startIndex: number,
): { name: string; params: string; indent: number; headerEndIndex: number } | undefined {
  const firstLine = lines[startIndex] ?? "";
  const startMatch = firstLine.match(PYTHON_DEF_START_PATTERN);
  if (!startMatch) return undefined;

  const indent = startMatch[1]?.length ?? 0;
  const name = startMatch[2] ?? "<anonymous>";
  const headerLines: string[] = [];
  const maxIndex = Math.min(lines.length - 1, startIndex + MAX_FUNCTION_HEADER_LINES - 1);

  for (let cursor = startIndex; cursor <= maxIndex; cursor += 1) {
    headerLines.push(lines[cursor] ?? "");
    const headerText = headerLines.join("\n");
    const headerMatch = headerText.match(/^\s*(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(([\s\S]*)\)\s*(?:->[\s\S]*)?:\s*(?:#.*)?$/);
    if (headerMatch) {
      return {
        name,
        params: headerMatch[1] ?? "",
        indent,
        headerEndIndex: cursor,
      };
    }
  }

  return undefined;
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
