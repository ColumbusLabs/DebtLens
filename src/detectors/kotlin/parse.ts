import type { SourceFileInfo } from "../../core/types.js";
import {
  extractBraceBodyLines,
  findMaskedBraceBlockEnd,
  findMatchingDelimiter,
  fingerprintNormalizedSnippet,
  maskScannedRanges,
  normalizeSnippetText,
  scanSlashTrivia,
  splitDelimitedArgs,
  type TriviaScannerCallbacks,
} from "../shared/parsePrimitives.js";

export interface KotlinFunction {
  name: string;
  params: string[];
  parameterTexts: string[];
  modifiers: string[];
  annotations: string[];
  file: SourceFileInfo;
  startLine: number;
  endLine: number;
  text: string;
  bodyLines: string[];
  expressionBody?: string;
}

export interface KotlinCommentSegment {
  text: string;
  line: number;
}

const kotlinModifiers = new Set([
  "public",
  "private",
  "protected",
  "internal",
  "override",
  "suspend",
  "inline",
  "tailrec",
  "operator",
  "infix",
  "open",
  "final",
  "abstract",
  "actual",
  "expect",
  "external",
]);

interface KotlinFunctionSignature {
  name: string;
  params: string;
  modifiers: string[];
  bodyDelimiter?: { char: "{" | "="; index: number };
}

export function extractKotlinFunctions(file: SourceFileInfo): KotlinFunction[] {
  const lines = file.content.split(/\r?\n/);
  const functions: KotlinFunction[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (isIgnorableFunctionPrefix(line)) continue;

    const header = collectKotlinFunctionHeader(lines, index);
    const signature = parseKotlinFunctionSignature(header.text);
    if (!signature) continue;

    const metadata = describeKotlinFunctionMetadata(lines, index, signature.modifiers);
    const expressionBody = extractExpressionBody(header.text, signature);
    const parameterTexts = splitKotlinArgs(signature.params);
    if (expressionBody !== undefined) {
      functions.push({
        name: signature.name,
        params: parseKotlinParams(signature.params),
        parameterTexts,
        modifiers: metadata.modifiers,
        annotations: metadata.annotations,
        file,
        startLine: index + 1,
        endLine: header.endIndex + 1,
        text: lines.slice(index, header.endIndex + 1).join("\n"),
        bodyLines: [expressionBody],
        expressionBody,
      });
      index = header.endIndex;
      continue;
    }

    if (signature.bodyDelimiter?.char !== "{") continue;

    const endIndex = findKotlinBlockEnd(lines, index, signature.bodyDelimiter.index);
    const textLines = lines.slice(index, endIndex + 1);
    functions.push({
      name: signature.name,
      params: parseKotlinParams(signature.params),
      parameterTexts,
      modifiers: metadata.modifiers,
      annotations: metadata.annotations,
      file,
      startLine: index + 1,
      endLine: endIndex + 1,
      text: textLines.join("\n"),
      bodyLines: extractBraceBodyLines(textLines),
    });
    index = endIndex;
  }

  return functions;
}

export function parseKotlinParams(raw: string): string[] {
  return splitKotlinArgs(raw)
    .map((param) => param.replace(/=.*/, "").trim())
    .map((param) => param.replace(/^(?:vararg|noinline|crossinline)\s+/, "").trim())
    .map((param) => param.replace(/^(?:val|var)\s+/, "").trim())
    .map((param) => param.split(":")[0]?.trim() ?? "")
    .filter((param) => /^[A-Za-z_]\w*$/.test(param))
    .filter(Boolean);
}

export function splitKotlinArgs(raw: string): string[] {
  return splitDelimitedArgs(raw, { includeAngleBrackets: true });
}

export function normalizeKotlinSnippet(text: string): string {
  return normalizeSnippetText(text, {
    maskComments: maskKotlinComments,
    keywords: kotlinKeywords,
  });
}

export function fingerprintKotlin(normalized: string): Map<string, number> {
  return fingerprintNormalizedSnippet(normalized);
}

export function countKotlinBranches(fn: KotlinFunction): number {
  const text = maskKotlinTrivia(fn.text);
  return text.match(/\b(?:if|when|for|while|catch)\b|&&|\|\||\?:/g)?.length ?? 0;
}

export function isKotlinSemanticNoopFunction(fn: KotlinFunction): boolean {
  const body = fn.expressionBody
    ? fn.expressionBody
    : fn.bodyLines.join("\n");
  const significant = maskKotlinTrivia(body).trim();
  return significant.length === 0 || significant === "Unit" || significant === "return Unit";
}

export function extractKotlinCommentSegments(file: SourceFileInfo): KotlinCommentSegment[] {
  const segments: KotlinCommentSegment[] = [];
  scanKotlin(file.content, {
    onComment: (text, line) => segments.push({ text, line }),
  });

  return segments;
}

function collectKotlinFunctionHeader(lines: string[], startIndex: number): { text: string; endIndex: number } {
  let text = lines[startIndex] ?? "";
  let endIndex = startIndex;

  while (!parseKotlinFunctionSignature(text)?.bodyDelimiter && endIndex + 1 < lines.length && endIndex - startIndex < 8) {
    endIndex += 1;
    text = `${text}\n${lines[endIndex] ?? ""}`;
  }

  return { text, endIndex };
}

function extractExpressionBody(header: string, signature: KotlinFunctionSignature): string | undefined {
  if (signature.bodyDelimiter?.char !== "=") return undefined;
  const expression = maskKotlinComments(stripLeadingAnnotations(header)).trimStart().slice(signature.bodyDelimiter.index + 1).trim();
  return expression || undefined;
}

function parseKotlinFunctionSignature(headerText: string): KotlinFunctionSignature | undefined {
  const header = maskKotlinComments(stripLeadingAnnotations(headerText)).trimStart();
  let cursor = 0;
  const modifiers: string[] = [];

  while (cursor < header.length) {
    const token = header.slice(cursor).match(/^([A-Za-z_]\w*)\b/);
    if (!token) break;
    const value = token[1] ?? "";
    if (value === "fun") {
      cursor += value.length;
      break;
    }
    if (!kotlinModifiers.has(value)) return undefined;
    modifiers.push(value);
    cursor += value.length;
    while (/\s/.test(header[cursor] ?? "")) cursor += 1;
  }

  if (header.slice(cursor - 3, cursor) !== "fun") return undefined;
  while (/\s/.test(header[cursor] ?? "")) cursor += 1;
  if (header[cursor] === "<") {
    const typeParameterEnd = findMatchingDelimiter(header, cursor, "<", ">");
    if (typeParameterEnd === -1) return undefined;
    cursor = typeParameterEnd + 1;
    while (/\s/.test(header[cursor] ?? "")) cursor += 1;
  }

  const paramsStart = findFunctionParameterStart(header, cursor);
  if (paramsStart === -1) return undefined;
  const receiverAndName = header.slice(cursor, paramsStart).trim();
  const name = receiverAndName.match(/([A-Za-z_]\w*)\s*$/)?.[1];
  if (!name) return undefined;

  const paramsEnd = findMatchingDelimiter(header, paramsStart, "(", ")");
  if (paramsEnd === -1) return undefined;
  const bodyDelimiter = findBodyDelimiter(header, paramsEnd + 1);
  return {
    name,
    params: header.slice(paramsStart + 1, paramsEnd),
    modifiers,
    bodyDelimiter,
  };
}

function findFunctionParameterStart(text: string, start: number): number {
  let angleDepth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === "<") angleDepth += 1;
    if (char === ">") angleDepth = Math.max(0, angleDepth - 1);
    if (char === "(" && angleDepth === 0) return index;
  }
  return -1;
}

function findBodyDelimiter(text: string, start: number): KotlinFunctionSignature["bodyDelimiter"] {
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === "<") angleDepth += 1;
    else if (char === ">") angleDepth = Math.max(0, angleDepth - 1);
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if ((char === "{" || char === "=") && angleDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      return { char, index };
    }
  }
  return undefined;
}

function findKotlinBlockEnd(lines: string[], startIndex: number, bodyDelimiterIndex: number): number {
  return findMaskedBraceBlockEnd(lines, startIndex, bodyDelimiterIndex, maskKotlinTrivia);
}

function isIgnorableFunctionPrefix(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return /^\/\//.test(trimmed) || /^\*/.test(trimmed) || (trimmed.startsWith("@") && !/\bfun\b/.test(trimmed));
}

function describeKotlinFunctionMetadata(
  lines: string[],
  index: number,
  modifiers: string[],
): { annotations: string[]; modifiers: string[] } {
  const annotations = [...collectLeadingAnnotations(lines, index), ...collectInlineAnnotations(lines[index] ?? "")];
  return { annotations, modifiers };
}

function collectLeadingAnnotations(lines: string[], index: number): string[] {
  const annotations: string[] = [];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const trimmed = (lines[cursor] ?? "").trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("@")) break;
    annotations.unshift(trimmed);
  }
  return annotations;
}

function collectInlineAnnotations(line: string): string[] {
  const functionStart = line.search(/\bfun\b/);
  const functionPrefix = functionStart === -1 ? line : line.slice(0, functionStart);
  return functionPrefix.match(/@[A-Za-z_][\w.]*\b(?:\([^)]*\))?/g) ?? [];
}

function stripLeadingAnnotations(text: string): string {
  let stripped = text.trimStart();
  while (stripped.startsWith("@")) {
    stripped = stripped.replace(/^@[A-Za-z_][\w.]*\b(?:\([^)]*\))?\s*/, "");
  }
  return stripped;
}

function maskKotlinComments(text: string): string {
  return maskScannedRanges(text, scanKotlin);
}

export function maskKotlinTrivia(text: string): string {
  return maskScannedRanges(text, scanKotlin, { includeStrings: true });
}

function scanKotlin(text: string, callbacks: KotlinScannerCallbacks): void {
  scanSlashTrivia(text, callbacks);
}

type KotlinScannerCallbacks = TriviaScannerCallbacks;

const kotlinKeywords = new Set([
  "as",
  "break",
  "catch",
  "class",
  "continue",
  "do",
  "else",
  "false",
  "finally",
  "for",
  "fun",
  "if",
  "in",
  "interface",
  "is",
  "null",
  "object",
  "package",
  "return",
  "super",
  "this",
  "throw",
  "true",
  "try",
  "typealias",
  "val",
  "var",
  "when",
  "while",
]);
