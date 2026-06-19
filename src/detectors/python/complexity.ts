import type { PythonFunction } from "./parse.js";

const BRANCH_TOKEN_PATTERN = /\b(?:if|elif|for|while|except|case|and|or)\b/g;
const CONTROL_LINE_PATTERN = /^(?:if|elif|else|for|while|try|except|finally|with|match|case)\b.*:/;

export interface PythonControlFlowMetrics {
  branches: number;
  complexity: number;
  maxDepth: number;
}

export function analyzePythonControlFlow(fn: PythonFunction): PythonControlFlowMetrics {
  const maskedText = maskPythonTrivia(fn.text);
  const branches = countPythonBranchTokens(maskedText);
  return {
    branches,
    complexity: branches + 1,
    maxDepth: computePythonMaxControlDepth(fn.bodyLines),
  };
}

function countPythonBranchTokens(maskedText: string): number {
  return maskedText.match(BRANCH_TOKEN_PATTERN)?.length ?? 0;
}

function computePythonMaxControlDepth(lines: string[]): number {
  const maskedLines = maskPythonTrivia(lines.join("\n")).split(/\r?\n/);
  const controlStack: number[] = [];
  let maxDepth = 0;

  for (const line of maskedLines) {
    if (!line.trim()) continue;
    const indent = indentation(line);
    while (controlStack.length > 0 && indent <= (controlStack[controlStack.length - 1] ?? 0)) {
      controlStack.pop();
    }

    if (!isControlLine(line)) continue;
    const depth = controlStack.length + 1;
    maxDepth = Math.max(maxDepth, depth);
    controlStack.push(indent);
  }

  return maxDepth;
}

function isControlLine(line: string): boolean {
  return CONTROL_LINE_PATTERN.test(line.trim());
}

function indentation(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function maskPythonTrivia(text: string): string {
  let masked = "";
  let index = 0;
  let quote: "\"" | "'" | undefined;
  let isTriple = false;

  while (index < text.length) {
    const char = text[index] ?? "";

    if (quote) {
      const tripleTerminator = quote.repeat(3);
      if (isTriple && text.startsWith(tripleTerminator, index)) {
        masked += "   ";
        index += 3;
        quote = undefined;
        isTriple = false;
        continue;
      }

      if (!isTriple && char === "\\") {
        masked += " ";
        index += 1;
        if (index < text.length) {
          masked += text[index] === "\n" ? "\n" : " ";
          index += 1;
        }
        continue;
      }

      if (!isTriple && char === quote) {
        masked += " ";
        index += 1;
        quote = undefined;
        continue;
      }

      if (!isTriple && char === "\n") {
        masked += "\n";
        index += 1;
        quote = undefined;
        continue;
      }

      masked += char === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }

    if (char === "#") {
      while (index < text.length && text[index] !== "\n") {
        masked += " ";
        index += 1;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      isTriple = text.startsWith(char.repeat(3), index);
      const width = isTriple ? 3 : 1;
      masked += " ".repeat(width);
      index += width;
      continue;
    }

    masked += char;
    index += 1;
  }

  return masked;
}
