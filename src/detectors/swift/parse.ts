import type { SourceFileInfo } from "../../core/types.js";
import {
  countLineBreaks,
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

export interface SwiftFunction {
  name: string;
  params: string[];
  parameterTexts: string[];
  modifiers: string[];
  attributes: string[];
  file: SourceFileInfo;
  startLine: number;
  endLine: number;
  text: string;
  bodyLines: string[];
  expressionBody?: string;
  parentViewStruct?: string;
  isViewBody?: boolean;
}

export interface SwiftViewStruct {
  name: string;
  attributes: string[];
  conformsTo: string[];
  file: SourceFileInfo;
  startLine: number;
  endLine: number;
  text: string;
  bodyLines: string[];
  bodyStartLine: number;
  bodyEndLine: number;
  propertyDeclarations: string[];
}

export interface SwiftCommentSegment {
  text: string;
  line: number;
}

const swiftModifiers = new Set([
  "public",
  "private",
  "fileprivate",
  "internal",
  "open",
  "static",
  "class",
  "mutating",
  "nonmutating",
  "override",
  "final",
  "convenience",
  "required",
  "lazy",
  "dynamic",
  "infix",
  "prefix",
  "postfix",
]);

interface SwiftFunctionSignature {
  name: string;
  params: string;
  modifiers: string[];
  bodyDelimiter?: { char: "{" | "=>"; index: number };
}

export function extractSwiftFunctions(file: SourceFileInfo): SwiftFunction[] {
  const lines = file.content.split(/\r?\n/);
  const viewStructs = extractSwiftViewStructs(file);
  const viewRanges = viewStructs.map((view) => ({
    name: view.name,
    start: view.startLine,
    end: view.endLine,
    bodyStart: view.bodyStartLine,
    bodyEnd: view.bodyEndLine,
  }));
  const functions: SwiftFunction[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (isIgnorableFunctionPrefix(line)) continue;

    const header = collectSwiftFunctionHeader(lines, index);
    const signature = parseSwiftFunctionSignature(header.text);
    if (!signature) continue;

    const metadata = describeSwiftFunctionMetadata(lines, index, signature.modifiers);
    const expressionBody = extractExpressionBody(header.text, signature);
    const parameterTexts = splitSwiftArgs(signature.params);
    const parentView = viewRanges.find((view) => index + 1 >= view.start && index + 1 <= view.end);
    const isViewBody = Boolean(
      parentView
      && signature.name === "body"
      && index + 1 >= parentView.bodyStart
      && index + 1 <= parentView.bodyEnd,
    );

    if (expressionBody !== undefined) {
      functions.push({
        name: signature.name,
        params: parseSwiftParams(signature.params),
        parameterTexts,
        modifiers: metadata.modifiers,
        attributes: metadata.attributes,
        file,
        startLine: index + 1,
        endLine: header.endIndex + 1,
        text: lines.slice(index, header.endIndex + 1).join("\n"),
        bodyLines: [expressionBody],
        expressionBody,
        parentViewStruct: parentView?.name,
        isViewBody,
      });
      index = header.endIndex;
      continue;
    }

    if (signature.bodyDelimiter?.char !== "{") continue;

    const endIndex = findSwiftBlockEnd(lines, index, signature.bodyDelimiter.index);
    const textLines = lines.slice(index, endIndex + 1);
    functions.push({
      name: signature.name,
      params: parseSwiftParams(signature.params),
      parameterTexts,
      modifiers: metadata.modifiers,
      attributes: metadata.attributes,
      file,
      startLine: index + 1,
      endLine: endIndex + 1,
      text: textLines.join("\n"),
      bodyLines: extractBraceBodyLines(textLines),
      parentViewStruct: parentView?.name,
      isViewBody,
    });
    index = endIndex;
  }

  return functions;
}

export function extractSwiftViewStructs(file: SourceFileInfo): SwiftViewStruct[] {
  const lines = file.content.split(/\r?\n/);
  const views: SwiftViewStruct[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const header = collectSwiftStructHeader(lines, index);
    if (!header) continue;
    if (!isViewConformance(header.conformsTo)) continue;

    const endIndex = findSwiftBlockEnd(lines, index, header.bodyDelimiterIndex);
    const textLines = lines.slice(index, endIndex + 1);
    const body = extractViewBody(textLines, index);
    if (!body) {
      index = endIndex;
      continue;
    }

    views.push({
      name: header.name,
      attributes: collectLeadingAttributes(lines, index),
      conformsTo: header.conformsTo,
      file,
      startLine: index + 1,
      endLine: endIndex + 1,
      text: textLines.join("\n"),
      bodyLines: body.bodyLines,
      bodyStartLine: body.startLine,
      bodyEndLine: body.endLine,
      propertyDeclarations: extractStructPropertyDeclarations(textLines),
    });
    index = endIndex;
  }

  return views;
}

export function parseSwiftParams(raw: string): string[] {
  return splitSwiftArgs(raw)
    .map(parseSwiftParamName)
    .filter(Boolean);
}

export function splitSwiftArgs(raw: string): string[] {
  return splitDelimitedArgs(raw, { includeAngleBrackets: true });
}

export function normalizeSwiftSnippet(text: string): string {
  return normalizeSnippetText(text, {
    maskComments: maskSwiftComments,
    keywords: swiftKeywords,
  });
}

export function fingerprintSwift(normalized: string): Map<string, number> {
  return fingerprintNormalizedSnippet(normalized);
}

export function countSwiftBranches(fn: SwiftFunction): number {
  const text = maskSwiftTrivia(fn.text);
  return text.match(/\b(?:if|guard|switch|for|while|catch)\b|&&|\|\||\?:/g)?.length ?? 0;
}

export function countSwiftViewBranches(view: SwiftViewStruct): number {
  const text = maskSwiftTrivia(view.bodyLines.join("\n"));
  return text.match(/\b(?:if|guard|switch|for|while|catch)\b|&&|\|\||\?:/g)?.length ?? 0;
}

export function extractSwiftCommentSegments(file: SourceFileInfo): SwiftCommentSegment[] {
  const segments: SwiftCommentSegment[] = [];
  scanSwift(file.content, {
    onComment: (text, line) => segments.push({ text, line }),
  });
  return segments;
}

function collectSwiftFunctionHeader(lines: string[], startIndex: number): { text: string; endIndex: number } {
  let text = lines[startIndex] ?? "";
  let endIndex = startIndex;

  while (!parseSwiftFunctionSignature(text)?.bodyDelimiter && endIndex + 1 < lines.length && endIndex - startIndex < 8) {
    endIndex += 1;
    text = `${text}\n${lines[endIndex] ?? ""}`;
  }

  return { text, endIndex };
}

function collectSwiftStructHeader(lines: string[], startIndex: number): {
  name: string;
  conformsTo: string[];
  bodyDelimiterIndex: number;
} | undefined {
  let text = lines[startIndex] ?? "";
  let endIndex = startIndex;

  while (!text.includes("{") && endIndex + 1 < lines.length && endIndex - startIndex < 8) {
    endIndex += 1;
    text = `${text}\n${lines[endIndex] ?? ""}`;
  }

  const normalized = maskSwiftComments(stripLeadingAttributes(text)).trimStart();
  const match = normalized.match(/^struct\s+([A-Za-z_]\w*)\s*(?::\s*([^{]+))?\s*\{/);
  if (!match) return undefined;

  const bodyDelimiterIndex = text.indexOf("{");
  if (bodyDelimiterIndex === -1) return undefined;

  return {
    name: match[1] ?? "",
    conformsTo: (match[2] ?? "").split(",").map((part) => part.trim()).filter(Boolean),
    bodyDelimiterIndex,
  };
}

function extractExpressionBody(header: string, signature: SwiftFunctionSignature): string | undefined {
  if (signature.bodyDelimiter?.char !== "=>") return undefined;
  const expression = maskSwiftComments(stripLeadingAttributes(header)).trimStart().slice(signature.bodyDelimiter.index + 2).trim();
  return expression || undefined;
}

function parseSwiftFunctionSignature(headerText: string): SwiftFunctionSignature | undefined {
  const header = maskSwiftComments(stripLeadingAttributes(headerText)).trimStart();
  let cursor = 0;
  const modifiers: string[] = [];

  while (cursor < header.length) {
    const token = header.slice(cursor).match(/^([A-Za-z_]\w*)\b/);
    if (!token) break;
    const value = token[1] ?? "";
    if (value === "func") {
      cursor += value.length;
      break;
    }
    if (!swiftModifiers.has(value)) return undefined;
    modifiers.push(value);
    cursor += value.length;
    while (/\s/.test(header[cursor] ?? "")) cursor += 1;
  }

  if (header.slice(cursor - 4, cursor) !== "func") return undefined;
  while (/\s/.test(header[cursor] ?? "")) cursor += 1;

  const nameMatch = header.slice(cursor).match(/^([A-Za-z_]\w*)/);
  if (!nameMatch) return undefined;
  const name = nameMatch[1] ?? "";
  cursor += name.length;
  while (/\s/.test(header[cursor] ?? "")) cursor += 1;

  if (header[cursor] === "<") {
    const genericEnd = findMatchingDelimiter(header, cursor, "<", ">");
    if (genericEnd === -1) return undefined;
    cursor = genericEnd + 1;
    while (/\s/.test(header[cursor] ?? "")) cursor += 1;
  }

  if (header[cursor] !== "(") return undefined;

  const paramsStart = cursor;
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

function findBodyDelimiter(text: string, start: number): SwiftFunctionSignature["bodyDelimiter"] {
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
    else if ((char === "{" || (char === "=" && text[index + 1] === ">")) && angleDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      return { char: char === "{" ? "{" : "=>", index };
    }
  }
  return undefined;
}

function findSwiftBlockEnd(lines: string[], startIndex: number, bodyDelimiterIndex: number): number {
  return findMaskedBraceBlockEnd(lines, startIndex, bodyDelimiterIndex, maskSwiftTrivia);
}

function parseSwiftParamName(rawParam: string): string {
  const declaration = rawParam
    .replace(/=.*/, "")
    .replace(/@[A-Za-z_][\w.]*\b(?:\([^)]*\))?/g, "")
    .replace(/\.\.\./g, "")
    .trim();
  const namePart = declaration.split(":")[0]?.trim() ?? "";
  const tokens = namePart
    .split(/\s+/)
    .filter((token) => token && !["inout", "some", "any", "borrowing", "consuming"].includes(token));
  const localName = tokens.at(-1)?.replace(/^_+$/, "") ?? "";
  return /^[A-Za-z_]\w*$/.test(localName) ? localName : "";
}

function extractViewBody(textLines: string[], startIndex: number): {
  bodyLines: string[];
  startLine: number;
  endLine: number;
} | undefined {
  const text = textLines.join("\n");
  const bodyMatch = maskSwiftComments(text).match(/\bvar\s+body\s*:\s*[^={]+\s*\{/);
  if (!bodyMatch || bodyMatch.index === undefined) return undefined;

  const bodyDelimiterIndex = text.indexOf("{", bodyMatch.index);
  if (bodyDelimiterIndex === -1) return undefined;
  const bodyEndIndex = findSwiftBlockEndOffset(text, bodyDelimiterIndex);
  if (bodyEndIndex === -1) return undefined;
  const bodyLines = text.slice(bodyDelimiterIndex + 1, bodyEndIndex).split(/\r?\n/);
  return {
    bodyLines,
    startLine: startIndex + countLineBreaks(text.slice(0, bodyDelimiterIndex)) + 1,
    endLine: startIndex + countLineBreaks(text.slice(0, bodyEndIndex)) + 1,
  };
}

function findSwiftBlockEndOffset(text: string, bodyDelimiterIndex: number): number {
  const code = maskSwiftTrivia(text);
  let depth = 0;
  let seenBlock = false;

  for (let index = bodyDelimiterIndex; index < code.length; index += 1) {
    const char = code[index] ?? "";
    if (char === "{") {
      seenBlock = true;
      depth += 1;
    } else if (char === "}" && seenBlock) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function extractStructPropertyDeclarations(textLines: string[]): string[] {
  const declarations: string[] = [];
  const text = textLines.join("\n");
  const bodyStart = text.indexOf("{");
  const bodyEnd = text.lastIndexOf("}");
  if (bodyStart === -1 || bodyEnd <= bodyStart) return declarations;

  const memberText = text.slice(bodyStart + 1, bodyEnd);
  const maskedMemberText = maskSwiftTrivia(memberText);
  const bodyStartLine = countLineBreaks(text.slice(0, bodyStart + 1));
  const declarationPattern = /(?:^|[\n;])\s*((?:@[A-Za-z_][\w.]*\b(?:\([^)]*\))?\s*)*(?:private|fileprivate|internal|public|open)?\s*(?:var|let)\s+[\s\S]*?)(?=[\n;]|$)/g;

  for (const match of maskedMemberText.matchAll(declarationPattern)) {
    const declaration = match[1]?.replace(/\s+/g, " ").trim() ?? "";
    if (!declaration || /\bbody\s*:/.test(declaration)) continue;
    if (!declaration.includes("@") && !/[=:(]/.test(declaration)) continue;
    if (viewsContainFunction(declaration)) continue;
    declarations.push(declaration);
    if (declarations.length >= 24) break;
  }

  return declarations;
}

function viewsContainFunction(declaration: string): boolean {
  return /\bfunc\s+[A-Za-z_]\w*\s*\(/.test(declaration);
}

function isViewConformance(conformsTo: string[]): boolean {
  return conformsTo.some((type) => /\bView\b/.test(type));
}

function isIgnorableFunctionPrefix(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return /^\/\//.test(trimmed) || /^\*/.test(trimmed) || (trimmed.startsWith("@") && !/\bfunc\b/.test(trimmed));
}

function describeSwiftFunctionMetadata(
  lines: string[],
  index: number,
  modifiers: string[],
): { attributes: string[]; modifiers: string[] } {
  const attributes = [...collectLeadingAttributes(lines, index), ...collectInlineAttributes(lines[index] ?? "")];
  return { attributes, modifiers };
}

function collectLeadingAttributes(lines: string[], index: number): string[] {
  const attributes: string[] = [];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const trimmed = (lines[cursor] ?? "").trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("@") && !trimmed.startsWith("#")) break;
    attributes.unshift(trimmed);
  }
  return attributes;
}

function collectInlineAttributes(line: string): string[] {
  const functionStart = line.search(/\bfunc\b/);
  const functionPrefix = functionStart === -1 ? line : line.slice(0, functionStart);
  return functionPrefix.match(/[@#][A-Za-z_][\w.]*\b(?:\([^)]*\))?/g) ?? [];
}

function stripLeadingAttributes(text: string): string {
  let stripped = text.trimStart();
  while (stripped.startsWith("@") || stripped.startsWith("#")) {
    stripped = stripped.replace(/^[@#][A-Za-z_][\w.]*\b(?:\([^)]*\))?\s*/, "");
  }
  return stripped;
}

function maskSwiftComments(text: string): string {
  return maskScannedRanges(text, scanSwift);
}

export function maskSwiftTrivia(text: string): string {
  return maskScannedRanges(text, scanSwift, { includeStrings: true });
}

function scanSwift(text: string, callbacks: SwiftScannerCallbacks): void {
  scanSlashTrivia(text, callbacks);
}

type SwiftScannerCallbacks = TriviaScannerCallbacks;

const swiftKeywords = new Set([
  "as",
  "break",
  "case",
  "catch",
  "class",
  "continue",
  "default",
  "defer",
  "do",
  "else",
  "enum",
  "extension",
  "false",
  "for",
  "func",
  "guard",
  "if",
  "import",
  "in",
  "init",
  "is",
  "let",
  "nil",
  "protocol",
  "return",
  "self",
  "struct",
  "switch",
  "throw",
  "true",
  "try",
  "typealias",
  "var",
  "when",
  "where",
  "while",
]);
