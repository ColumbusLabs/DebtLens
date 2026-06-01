import type { Node } from "ts-morph";

export function nodeLineSpan(node: Node): { startLine: number; endLine: number; lines: number } {
  const source = node.getSourceFile();
  const start = source.getLineAndColumnAtPos(node.getStart());
  const end = source.getLineAndColumnAtPos(node.getEnd());
  return {
    startLine: start.line,
    endLine: end.line,
    lines: Math.max(1, end.line - start.line + 1),
  };
}

export function lineAt(content: string, lineNumber: number): string {
  return content.split(/\r?\n/)[lineNumber - 1] ?? "";
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}
