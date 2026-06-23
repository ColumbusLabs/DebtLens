export interface TriviaScannerCallbacks {
  onComment?: (text: string, line: number, start: number, end: number) => void;
  onString?: (start: number, end: number) => void;
}

interface SplitDelimitedArgsOptions {
  includeAngleBrackets?: boolean;
}

interface NormalizeSnippetOptions {
  maskComments: (text: string) => string;
  keywords: ReadonlySet<string>;
  identifierPattern?: RegExp;
  isKeyword?: (token: string) => boolean;
}

export function splitDelimitedArgs(raw: string, options: SplitDelimitedArgsOptions = {}): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | undefined;
  const opens = options.includeAngleBrackets ? "([{<" : "([{";
  const closes = options.includeAngleBrackets ? ")]}>" : ")]}";

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
    if (opens.includes(char)) depth += 1;
    if (closes.includes(char)) depth = Math.max(0, depth - 1);
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

export function normalizeSnippetText(text: string, options: NormalizeSnippetOptions): string {
  const identifierPattern = options.identifierPattern ?? /\b[A-Za-z_]\w*\b/g;
  return options.maskComments(text)
    .replace(/("""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, " STR ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " NUM ")
    .replace(identifierPattern, (token) => {
      const isKeyword = options.isKeyword ? options.isKeyword(token) : options.keywords.has(token);
      return isKeyword ? token : "ID";
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprintNormalizedSnippet(normalized: string): Map<string, number> {
  const fingerprint = new Map<string, number>();
  for (const token of normalized.match(/[A-Za-z_]+|[()[\]{}:,.=+\-*/<>]/g) ?? []) {
    fingerprint.set(token, (fingerprint.get(token) ?? 0) + 1);
  }
  return fingerprint;
}

export function findMatchingDelimiter(text: string, start: number, open: string, close: string): number {
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

export function findMaskedBraceBlockEnd(
  lines: string[],
  startIndex: number,
  bodyDelimiterIndex: number,
  maskTrivia: (text: string) => string,
): number {
  return createMaskedBraceBlockFinder(lines, maskTrivia)(startIndex, bodyDelimiterIndex);
}

export function createMaskedBraceBlockFinder(
  lines: string[],
  maskTrivia: (text: string) => string,
): (startIndex: number, bodyDelimiterIndex: number) => number {
  const text = lines.join("\n");
  const code = maskTrivia(text);
  const lineStarts = buildLineStartOffsets(lines);

  return (startIndex, bodyDelimiterIndex) => {
    const startOffset = (lineStarts[startIndex] ?? 0) + bodyDelimiterIndex;
    let depth = 0;
    let seenBlock = false;

    for (let index = startOffset; index < code.length; index += 1) {
      const char = code[index] ?? "";
      if (char === "{") {
        seenBlock = true;
        depth += 1;
      } else if (char === "}" && seenBlock) {
        depth -= 1;
        if (depth === 0) return lineIndexForOffset(lineStarts, index);
      }
    }

    return startIndex;
  };
}

function buildLineStartOffsets(lines: string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function lineIndexForOffset(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const current = lineStarts[mid] ?? 0;
    const next = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (offset >= current && offset < next) return mid;
    if (offset < current) high = mid - 1;
    else low = mid + 1;
  }

  return Math.max(0, lineStarts.length - 1);
}

export function countLineBreaks(text: string): number {
  return text.match(/\n/g)?.length ?? 0;
}

export function extractBraceBodyLines(textLines: string[]): string[] {
  const text = textLines.join("\n");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  return text.slice(start + 1, end).split(/\r?\n/);
}

export function scanSlashTrivia(text: string, callbacks: TriviaScannerCallbacks): void {
  let index = 0;
  let line = 1;

  while (index < text.length) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    const nextThree = text.slice(index, index + 3);

    if (nextThree === "\"\"\"") {
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

export function maskScannedRanges(
  text: string,
  scan: (text: string, callbacks: TriviaScannerCallbacks) => void,
  options: { includeStrings?: boolean } = {},
): string {
  const chars = [...text];
  scan(text, {
    onComment: (_comment, _line, start, end) => maskRange(chars, start, end),
    ...(options.includeStrings ? { onString: (start: number, end: number) => maskRange(chars, start, end) } : {}),
  });
  return chars.join("");
}

export function maskRange(chars: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (chars[index] !== "\n") chars[index] = " ";
  }
}
