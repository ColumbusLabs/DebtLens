import type { SourceFileInfo } from "../../core/types.js";
import {
  findMatchingDelimiter,
  fingerprintNormalizedSnippet,
  maskScannedRanges,
  normalizeSnippetText,
  splitDelimitedArgs,
} from "../shared/parsePrimitives.js";

export interface RubyFunction {
  name: string;
  params: string[];
  parameterTexts: string[];
  modifiers: string[];
  visibility: "public" | "private" | "protected";
  file: SourceFileInfo;
  startLine: number;
  endLine: number;
  text: string;
  bodyLines: string[];
  expressionBody?: string;
}

export interface RubyCommentSegment {
  text: string;
  line: number;
}

interface RubyFunctionSignature {
  name: string;
  params: string;
  modifiers: string[];
}

export function extractRubyFunctions(file: SourceFileInfo): RubyFunction[] {
  const lines = file.content.split(/\r?\n/);
  const functions: RubyFunction[] = [];
  let visibility: RubyFunction["visibility"] = "public";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = maskRubyComments(line).trim();
    const visibilityMatch = trimmed.match(/^(private|protected|public)\b/);
    if (visibilityMatch) {
      visibility = visibilityMatch[1] as RubyFunction["visibility"];
      continue;
    }

    if (isIgnorableFunctionPrefix(line)) continue;
    if (!/^def\b/.test(trimmed)) continue;

    const header = collectRubyFunctionHeader(lines, index);
    const signature = parseRubyFunctionSignature(header.text);
    if (!signature) continue;

    const endIndex = findRubyMethodEnd(lines, index);
    const textLines = lines.slice(index, endIndex + 1);
    const expressionBody = extractRubyExpressionBody(header.text, signature);
    const parameterTexts = splitRubyArgs(signature.params);

    functions.push({
      name: signature.name,
      params: parseRubyParams(signature.params),
      parameterTexts,
      modifiers: signature.modifiers,
      visibility,
      file,
      startLine: index + 1,
      endLine: endIndex + 1,
      text: textLines.join("\n"),
      bodyLines: expressionBody ? [expressionBody] : extractRubyBodyLines(textLines),
      expressionBody,
    });
    index = endIndex;
  }

  return functions;
}

export function parseRubyParams(raw: string): string[] {
  return splitRubyArgs(raw)
    .map((param) => param.replace(/=.*/, "").trim())
    .map((param) => param.replace(/^\*/, "").trim())
    .map((param) => param.replace(/^[&%$@]/, "").trim())
    .map((param) => param.split(":")[0]?.trim() ?? "")
    .filter((param) => /^[A-Za-z_]\w*$/.test(param))
    .filter(Boolean);
}

export function splitRubyArgs(raw: string): string[] {
  return splitDelimitedArgs(raw);
}

export function normalizeRubySnippet(text: string): string {
  return normalizeSnippetText(text, {
    maskComments: maskRubyComments,
    keywords: rubyKeywords,
    identifierPattern: /\b[A-Za-z_]\w*[?!]?\b/g,
    isKeyword: (token) => rubyKeywords.has(token.replace(/[?!]$/, "")),
  });
}

export function fingerprintRuby(normalized: string): Map<string, number> {
  return fingerprintNormalizedSnippet(normalized);
}

export function countRubyBranches(fn: RubyFunction): number {
  const text = maskRubyTrivia(fn.text);
  return text.match(/\b(?:if|elsif|unless|case|when|while|until|for|rescue)\b|&&|\|\||\?:/g)?.length ?? 0;
}

export function extractRubyCommentSegments(file: SourceFileInfo): RubyCommentSegment[] {
  const segments: RubyCommentSegment[] = [];
  scanRuby(file.content, {
    onComment: (text, line) => segments.push({ text, line }),
  });
  return segments;
}

function collectRubyFunctionHeader(lines: string[], startIndex: number): { text: string; endIndex: number } {
  let text = lines[startIndex] ?? "";
  let endIndex = startIndex;

  while (!hasCompleteRubyHeader(text) && endIndex + 1 < lines.length && endIndex - startIndex < 8) {
    endIndex += 1;
    text = `${text}\n${lines[endIndex] ?? ""}`;
  }

  return { text, endIndex };
}

function hasCompleteRubyHeader(text: string): boolean {
  const header = maskRubyComments(text).trimStart();
  if (!/\bdef\b/.test(header)) return false;
  const openParens = (header.match(/\(/g) ?? []).length;
  const closeParens = (header.match(/\)/g) ?? []).length;
  if (openParens > closeParens) return false;
  return true;
}

function extractRubyExpressionBody(header: string, signature: RubyFunctionSignature): string | undefined {
  const masked = maskRubyComments(header).trimStart();
  const defIndex = masked.search(/\bdef\b/);
  if (defIndex === -1) return undefined;
  const afterDef = masked.slice(defIndex);
  const inlineBody = afterDef.match(/\)\s*(.+)$/s)?.[1]?.trim()
    ?? afterDef.match(/\bdef\s+[A-Za-z_][\w.!?]*\s+(.+)$/s)?.[1]?.trim();
  if (!inlineBody || inlineBody === "") return undefined;
  if (/^\s*$/.test(inlineBody)) return undefined;
  if (inlineBody.startsWith(";")) return inlineBody.slice(1).trim() || undefined;
  return undefined;
}

function parseRubyFunctionSignature(headerText: string): RubyFunctionSignature | undefined {
  const header = maskRubyComments(headerText).trimStart();
  const defIndex = header.search(/\bdef\b/);
  if (defIndex === -1) return undefined;

  let cursor = defIndex + 3;
  while (/\s/.test(header[cursor] ?? "")) cursor += 1;

  const nameMatch = header.slice(cursor).match(/^([A-Za-z_][\w.!?]*)/);
  if (!nameMatch) return undefined;
  const name = nameMatch[1] ?? "";
  cursor += name.length;
  while (/\s/.test(header[cursor] ?? "")) cursor += 1;

  let params = "";
  if (header[cursor] === "(") {
    const paramsEnd = findMatchingDelimiter(header, cursor, "(", ")");
    if (paramsEnd === -1) return undefined;
    params = header.slice(cursor + 1, paramsEnd);
    cursor = paramsEnd + 1;
  } else {
    const rest = header.slice(cursor).trim();
    if (rest && !rest.startsWith(";") && !rest.startsWith("\n")) {
      const paramEnd = rest.search(/[;\n]/);
      params = paramEnd === -1 ? rest : rest.slice(0, paramEnd);
    }
  }

  return {
    name,
    params,
    modifiers: [],
  };
}

function findRubyMethodEnd(lines: string[], startIndex: number): number {
  let depth = 0;

  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = maskRubyTrivia(lines[index] ?? "").trim();
    if (!trimmed) continue;

    if (/^def\b/.test(trimmed)) {
      if (index > startIndex) return index - 1;
      depth += 1;
      continue;
    }

    depth += countRubyBlockOpeners(trimmed);
    depth -= countRubyBlockClosers(trimmed);

    if (depth <= 0) return index;
  }

  return lines.length - 1;
}

function countRubyBlockOpeners(line: string): number {
  let count = 0;
  const patterns = [
    /(?:^|[=([{;,]\s*)\bclass\b/g,
    /(?:^|[=([{;,]\s*)\bmodule\b/g,
    /(?:^|[=([{;,]\s*)\bif\b/g,
    /(?:^|[=([{;,]\s*)\bunless\b/g,
    /(?:^|[=([{;,]\s*)\bcase\b/g,
    /(?:^|[=([{;,]\s*)\bwhile\b/g,
    /(?:^|[=([{;,]\s*)\buntil\b/g,
    /(?:^|[=([{;,]\s*)\bfor\b/g,
    /(?:^|[=([{;,]\s*)\bbegin\b/g,
  ];

  for (const pattern of patterns) {
    count += line.match(pattern)?.length ?? 0;
  }

  count += line.match(/\bdo\b/g)?.length ?? 0;
  return count;
}

function countRubyBlockClosers(line: string): number {
  return line.match(/\bend\b/g)?.length ?? 0;
}

function extractRubyBodyLines(textLines: string[]): string[] {
  if (textLines.length <= 1) return [];
  return textLines.slice(1, -1);
}

function isIgnorableFunctionPrefix(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return /^#/.test(trimmed) || (trimmed.startsWith("=begin") && !/\bdef\b/.test(trimmed));
}

export function maskRubyComments(text: string): string {
  return maskScannedRanges(text, scanRuby);
}

export function maskRubyTrivia(text: string): string {
  return maskScannedRanges(text, scanRuby, { includeStrings: true });
}

interface RubyScannerCallbacks {
  onComment?: (text: string, line: number, start: number, end: number) => void;
  onString?: (start: number, end: number) => void;
}

function scanRuby(text: string, callbacks: RubyScannerCallbacks): void {
  let index = 0;
  let line = 1;

  while (index < text.length) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";

    if (text.startsWith("=begin", index)) {
      const start = index;
      const commentLine = line;
      index += 6;
      while (index < text.length && !text.startsWith("=end", index)) {
        if (text[index] === "\n") line += 1;
        index += 1;
      }
      index = Math.min(text.length, index + (text.startsWith("=end", index) ? 4 : 0));
      callbacks.onComment?.(text.slice(start, index), commentLine, start, index);
      continue;
    }

    if (char === "#") {
      const start = index;
      const commentLine = line;
      while (index < text.length && text[index] !== "\n") index += 1;
      callbacks.onComment?.(text.slice(start, index), commentLine, start, index);
      continue;
    }

    if (char === "\"" || char === "'") {
      const start = index;
      const quote = char;
      index += 1;
      while (index < text.length) {
        const current = text[index] ?? "";
        if (current === "\n") line += 1;
        if (current === quote && text[index - 1] !== "\\") {
          index += 1;
          break;
        }
        index += 1;
      }
      callbacks.onString?.(start, index);
      continue;
    }

    if (char === "\n") line += 1;
    index += 1;
  }
}

const rubyKeywords = new Set([
  "alias",
  "and",
  "begin",
  "break",
  "case",
  "class",
  "def",
  "defined",
  "do",
  "else",
  "elsif",
  "end",
  "ensure",
  "false",
  "for",
  "if",
  "in",
  "module",
  "next",
  "nil",
  "not",
  "or",
  "redo",
  "rescue",
  "retry",
  "return",
  "self",
  "super",
  "then",
  "true",
  "undef",
  "unless",
  "until",
  "when",
  "while",
  "yield",
]);
