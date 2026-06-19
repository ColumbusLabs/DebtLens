import type { SourceFileInfo } from "../../core/types.js";

export interface KotlinFunction {
  name: string;
  params: string[];
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
    if (expressionBody !== undefined) {
      functions.push({
        name: signature.name,
        params: parseKotlinParams(signature.params),
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

    const endIndex = findKotlinBlockEnd(lines, index);
    const textLines = lines.slice(index, endIndex + 1);
    functions.push({
      name: signature.name,
      params: parseKotlinParams(signature.params),
      modifiers: metadata.modifiers,
      annotations: metadata.annotations,
      file,
      startLine: index + 1,
      endLine: endIndex + 1,
      text: textLines.join("\n"),
      bodyLines: extractBlockBodyLines(textLines),
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
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | undefined;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] ?? "";
    const previous = raw[index - 1];
    if (quote) {
      current += char;
      if (char === quote && previous !== "\\") quote = undefined;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if ("([{<".includes(char)) depth += 1;
    if (")]}>" .includes(char)) depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      if (current.trim()) args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

export function normalizeKotlinSnippet(text: string): string {
  return maskKotlinComments(text)
    .replace(/("""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, " STR ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " NUM ")
    .replace(/\b[A-Za-z_]\w*\b/g, (token) => kotlinKeywords.has(token) ? token : "ID")
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprintKotlin(normalized: string): Map<string, number> {
  const fingerprint = new Map<string, number>();
  for (const token of normalized.match(/[A-Za-z_]+|[()[\]{}:,.=+\-*/<>]/g) ?? []) {
    fingerprint.set(token, (fingerprint.get(token) ?? 0) + 1);
  }
  return fingerprint;
}

export function countKotlinBranches(fn: KotlinFunction): number {
  const text = maskKotlinTrivia(fn.text);
  return text.match(/\b(?:if|when|for|while|catch)\b|&&|\|\||\?:/g)?.length ?? 0;
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
    text = `${text} ${(lines[endIndex] ?? "").trim()}`;
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

function findMatchingDelimiter(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote: string | undefined;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const previous = text[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = undefined;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findKotlinBlockEnd(lines: string[], startIndex: number): number {
  let depth = 0;
  let seenBlock = false;

  for (let index = startIndex; index < lines.length; index += 1) {
    const code = maskKotlinTrivia(lines[index] ?? "");
    for (const char of code) {
      if (char === "{") {
        seenBlock = true;
        depth += 1;
      } else if (char === "}" && seenBlock) {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
  }

  return startIndex;
}

function extractBlockBodyLines(textLines: string[]): string[] {
  const text = textLines.join("\n");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  return text.slice(start + 1, end).split(/\r?\n/);
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
  return line.match(/@[A-Za-z_]\w*(?:\([^)]*\))?/g) ?? [];
}

function stripLeadingAnnotations(text: string): string {
  let stripped = text.trimStart();
  while (stripped.startsWith("@")) {
    stripped = stripped.replace(/^@[A-Za-z_]\w*(?:\([^)]*\))?\s*/, "");
  }
  return stripped;
}

function maskKotlinComments(text: string): string {
  const chars = [...text];
  scanKotlin(text, {
    onComment: (_comment, _line, start, end) => maskRange(chars, start, end),
  });
  return chars.join("");
}

function maskKotlinTrivia(text: string): string {
  const chars = [...text];
  scanKotlin(text, {
    onComment: (_comment, _line, start, end) => maskRange(chars, start, end),
    onString: (start, end) => maskRange(chars, start, end),
  });
  return chars.join("");
}

interface KotlinScannerCallbacks {
  onComment?: (text: string, line: number, start: number, end: number) => void;
  onString?: (start: number, end: number) => void;
}

function scanKotlin(text: string, callbacks: KotlinScannerCallbacks): void {
  let index = 0;
  let line = 1;

  while (index < text.length) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    const nextTwo = text.slice(index, index + 3);

    if (nextTwo === "\"\"\"") {
      const start = index;
      index += 3;
      while (index < text.length && text.slice(index, index + 3) !== "\"\"\"") {
        if (text[index] === "\n") line += 1;
        index += 1;
      }
      index = Math.min(text.length, index + 3);
      callbacks.onString?.(start, index);
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

    if (char === "/" && next === "/") {
      const start = index;
      const commentLine = line;
      while (index < text.length && text[index] !== "\n") index += 1;
      callbacks.onComment?.(text.slice(start, index), commentLine, start, index);
      continue;
    }

    if (char === "/" && next === "*") {
      const start = index;
      const commentLine = line;
      let depth = 1;
      index += 2;
      while (index < text.length && depth > 0) {
        if (text[index] === "\n") line += 1;
        if (text[index] === "/" && text[index + 1] === "*") {
          depth += 1;
          index += 2;
          continue;
        }
        if (text[index] === "*" && text[index + 1] === "/") {
          depth -= 1;
          index += 2;
          continue;
        }
        index += 1;
      }
      callbacks.onComment?.(text.slice(start, index), commentLine, start, index);
      continue;
    }

    if (char === "\n") line += 1;
    index += 1;
  }
}

function maskRange(chars: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (chars[index] !== "\n") chars[index] = " ";
  }
}

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
