export interface SfcScriptBlock {
  attrs: string;
  content: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  setup: boolean;
  module: boolean;
  lang?: string;
}

const SCRIPT_OPEN_NAME = "script";
const SCRIPT_CLOSE_NAME = "/script";

export function extractSfcScriptBlocks(content: string): SfcScriptBlock[] {
  const blocks: SfcScriptBlock[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const openTag = findScriptOpenTag(content, cursor);
    if (!openTag) break;

    const attrs = openTag.attrs;
    const scriptStart = openTag.end;
    const closeTag = findScriptCloseTag(content, scriptStart);
    if (!closeTag) break;

    const scriptContent = content.slice(scriptStart, closeTag.start);
    const startLine = lineNumberAtIndex(content, scriptStart);
    const lineCount = Math.max(1, scriptContent.split(/\r?\n/).length);
    const attrMap = parseSfcAttributes(attrs);
    const lang = attrMap.get("lang");
    blocks.push({
      attrs,
      content: scriptContent,
      startOffset: scriptStart,
      endOffset: closeTag.start,
      startLine,
      endLine: startLine + lineCount - 1,
      setup: attrMap.has("setup"),
      module: attrMap.get("context") === "module" || attrMap.has("module"),
      lang: typeof lang === "string" ? lang : undefined,
    });

    cursor = closeTag.end;
  }

  return blocks;
}

export function getSfcVirtualScriptExtension(content: string): ".ts" | ".tsx" {
  return extractSfcScriptBlocks(content).some((block) => {
    const lang = block.lang?.toLowerCase();
    return lang === "tsx" || lang === "jsx";
  }) ? ".tsx" : ".ts";
}

export function buildSfcVirtualScriptContent(content: string): string {
  const virtualChars: string[] = content.split("").map((char) => char === "\n" || char === "\r" ? char : " ");

  for (const block of extractSfcScriptBlocks(content)) {
    for (let index = 0; index < block.content.length; index += 1) {
      virtualChars[block.startOffset + index] = block.content[index] ?? "";
    }
  }

  return virtualChars.join("");
}

function findScriptOpenTag(content: string, startIndex: number): { attrs: string; start: number; end: number } | undefined {
  let cursor = startIndex;

  while (cursor < content.length) {
    const tagStart = content.toLowerCase().indexOf(`<${SCRIPT_OPEN_NAME}`, cursor);
    if (tagStart < 0) return undefined;

    const afterName = content[tagStart + SCRIPT_OPEN_NAME.length + 1];
    if (!isTagNameBoundary(afterName)) {
      cursor = tagStart + SCRIPT_OPEN_NAME.length + 1;
      continue;
    }

    const tagEnd = findOpenTagEnd(content, tagStart + SCRIPT_OPEN_NAME.length + 1);
    if (tagEnd === undefined) return undefined;

    return {
      attrs: content.slice(tagStart + SCRIPT_OPEN_NAME.length + 1, tagEnd),
      start: tagStart,
      end: tagEnd + 1,
    };
  }

  return undefined;
}

function findOpenTagEnd(content: string, startIndex: number): number | undefined {
  let quote: "\"" | "'" | undefined;
  for (let cursor = startIndex; cursor < content.length; cursor += 1) {
    const char = content[cursor];
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return cursor;
  }
  return undefined;
}

function findScriptCloseTag(content: string, startIndex: number): { start: number; end: number } | undefined {
  let cursor = startIndex;

  while (cursor < content.length) {
    const char = content[cursor];
    const next = content[cursor + 1];

    if (char === "<") {
      const closeTag = readScriptCloseTag(content, cursor);
      if (closeTag) return closeTag;
      cursor += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      cursor = skipLineComment(content, cursor + 2);
      continue;
    }

    if (char === "/" && next === "*") {
      cursor = skipBlockComment(content, cursor + 2);
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      cursor = skipQuotedString(content, cursor + 1, char);
      continue;
    }

    cursor += 1;
  }

  return undefined;
}

function readScriptCloseTag(content: string, startIndex: number): { start: number; end: number } | undefined {
  const lower = content.slice(startIndex + 1, startIndex + 1 + SCRIPT_CLOSE_NAME.length).toLowerCase();
  if (lower !== SCRIPT_CLOSE_NAME) return undefined;

  let cursor = startIndex + 1 + SCRIPT_CLOSE_NAME.length;
  while (cursor < content.length && /\s/.test(content[cursor] ?? "")) cursor += 1;
  if (content[cursor] !== ">") return undefined;

  return { start: startIndex, end: cursor + 1 };
}

function isTagNameBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s>/]/.test(char);
}

function skipLineComment(content: string, startIndex: number): number {
  const newline = content.indexOf("\n", startIndex);
  return newline < 0 ? content.length : newline + 1;
}

function skipBlockComment(content: string, startIndex: number): number {
  const close = content.indexOf("*/", startIndex);
  return close < 0 ? content.length : close + 2;
}

function skipQuotedString(content: string, startIndex: number, quote: string): number {
  let cursor = startIndex;
  while (cursor < content.length) {
    const char = content[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === quote) return cursor + 1;
    cursor += 1;
  }
  return content.length;
}

function parseSfcAttributes(raw: string): Map<string, string | true> {
  const attrs = new Map<string, string | true>();
  for (const match of raw.matchAll(/([A-Za-z_:][-A-Za-z0-9_:]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    attrs.set(name, match[2] ?? match[3] ?? match[4] ?? true);
  }
  return attrs;
}

function lineNumberAtIndex(content: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content[cursor] === "\n") line += 1;
  }
  return line;
}
