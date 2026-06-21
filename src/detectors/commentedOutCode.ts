import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { resolveTodoCommentPatterns } from "./todoComment.js";

interface CommentLine {
  lineNumber: number;
  text: string;
  rawLine: string;
}

interface CommentRun {
  startLine: number;
  endLine: number;
  lines: CommentLine[];
}

export const commentedOutCodeDetector: Detector = {
  id: "commented-out-code",
  name: "Commented-out code",
  description: "Finds contiguous commented lines that look like abandoned code rather than prose or directives.",
  defaultSeverity: "low",
  tags: ["comments", "cleanup", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const minLines = context.getThreshold("commented-out-code.minLines", 2);
    const maxPerFile = context.getThreshold("commented-out-code.maxPerFile", 12);
    const todoPatterns = resolveTodoCommentPatterns(context);

    for (const file of context.files) {
      const lines = file.content.split(/\r?\n/);
      const commentLines = extractCommentLines(lines);
      const runs = groupCommentRuns(commentLines);
      let countForFile = 0;

      for (const run of runs) {
        if (run.lines.length < minLines) continue;
        if (isExcludedRun(run, todoPatterns)) continue;
        if (!runLooksLikeCommentedCode(run)) continue;

        issues.push(createIssue({
          detector: commentedOutCodeDetector,
          confidence: confidenceForRunLength(run.lines.length, minLines),
          file: file.relativePath,
          location: { startLine: run.startLine, endLine: run.endLine },
          message: `Comment block spans ${run.lines.length} lines that look like commented-out code.`,
          evidence: run.lines
            .map((line) => line.rawLine.trim().slice(0, 220))
            .slice(0, 4),
          suggestion: "Delete the commented-out code and rely on version control, or restore it if it is still needed.",
        }));

        countForFile += 1;
        if (countForFile >= maxPerFile) break;
      }
    }

    return issues;
  },
};

function extractCommentLines(lines: string[]): CommentLine[] {
  const commentLines: CommentLine[] = [];
  let inBlockComment = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;

    if (/debtlens-disable-(?:next-line|file)/i.test(line)) continue;

    if (inBlockComment) {
      const endIndex = line.indexOf("*/");
      if (endIndex >= 0) {
        inBlockComment = false;
        const beforeClose = line.slice(0, endIndex);
        const text = stripBlockCommentPrefix(beforeClose);
        if (text.length > 0 || beforeClose.trim().length > 0) {
          commentLines.push({ lineNumber, text, rawLine: line });
        } else {
          commentLines.push({ lineNumber, text: "", rawLine: line });
        }
        continue;
      }

      commentLines.push({
        lineNumber,
        text: stripBlockCommentPrefix(line),
        rawLine: line,
      });
      continue;
    }

    const blockStart = line.indexOf("/*");
    if (blockStart >= 0 && isOnlyWhitespace(line.slice(0, blockStart))) {
      const afterStart = line.slice(blockStart + 2);
      const endIndex = afterStart.indexOf("*/");
      if (endIndex >= 0) {
        const text = stripBlockCommentPrefix(afterStart.slice(0, endIndex));
        commentLines.push({ lineNumber, text, rawLine: line });
        continue;
      }

      inBlockComment = true;
      const text = stripBlockCommentPrefix(afterStart);
      commentLines.push({ lineNumber, text, rawLine: line });
      continue;
    }

    const lineCommentMatch = line.match(/^\s*\/\/(.*)$/);
    if (lineCommentMatch) {
      commentLines.push({
        lineNumber,
        text: (lineCommentMatch[1] ?? "").trim(),
        rawLine: line,
      });
    }
  }

  return commentLines;
}

function stripBlockCommentPrefix(line: string): string {
  return line.replace(/^\s*\*?\s?/, "").trim();
}

function isOnlyWhitespace(value: string): boolean {
  return value.trim().length === 0;
}

function groupCommentRuns(commentLines: CommentLine[]): CommentRun[] {
  if (commentLines.length === 0) return [];

  const runs: CommentRun[] = [];
  let current: CommentLine[] = [commentLines[0]!];

  for (let index = 1; index < commentLines.length; index += 1) {
    const line = commentLines[index]!;
    const previous = commentLines[index - 1]!;
    if (line.lineNumber === previous.lineNumber + 1) {
      current.push(line);
      continue;
    }

    runs.push({
      startLine: current[0]!.lineNumber,
      endLine: current[current.length - 1]!.lineNumber,
      lines: current,
    });
    current = [line];
  }

  runs.push({
    startLine: current[0]!.lineNumber,
    endLine: current[current.length - 1]!.lineNumber,
    lines: current,
  });

  return runs;
}

function isExcludedRun(
  run: CommentRun,
  todoPatterns: ReturnType<typeof resolveTodoCommentPatterns>,
): boolean {
  if (isDocumentationRun(run) || isSeparatorRun(run)) return true;

  for (const line of run.lines) {
    if (isLicenseOrCopyrightLine(line.rawLine, line.text)) return true;
    if (todoPatterns.some((pattern) => pattern.regex.test(line.rawLine))) return true;
  }
  return false;
}

function isLicenseOrCopyrightLine(rawLine: string, text: string): boolean {
  const combined = `${rawLine}\n${text}`;
  return /SPDX-License-Identifier/i.test(combined)
    || /\bCopyright\b/i.test(combined)
    || /\bLicensed under\b/i.test(combined)
    || /\bAll rights reserved\b/i.test(combined);
}

function runLooksLikeCommentedCode(run: CommentRun): boolean {
  const meaningful = run.lines
    .map((line) => line.text.trim())
    .filter(Boolean);
  if (meaningful.length === 0) return false;

  const codeLikeCount = meaningful.filter((line) => isCodeLikeComment(line)).length;
  if (codeLikeCount === 0) return false;
  if (codeLikeCount === meaningful.length) return true;
  return codeLikeCount >= 2 && codeLikeCount / meaningful.length >= 0.5;
}

function isDocumentationRun(run: CommentRun): boolean {
  const meaningful = run.lines
    .map((line) => line.text.trim())
    .filter(Boolean);
  if (meaningful.length === 0) return false;

  const looksLikeBlockDoc = run.lines.some((line) => /^\s*\/\*\*/.test(line.rawLine));
  const hasDocTag = meaningful.some((line) => /^@[A-Za-z][\w-]*/.test(line));
  if (looksLikeBlockDoc && meaningful.some((line) => isDocumentationSignalLine(line))) {
    return true;
  }
  if (!looksLikeBlockDoc && !hasDocTag) return false;

  return meaningful.every((line) => isDocumentationLine(line));
}

function isDocumentationSignalLine(text: string): boolean {
  if (isBlockDelimiterLine(text)) return false;
  if (/^@[A-Za-z][\w-]*/.test(text)) return true;
  if (/^\{?@[A-Za-z][\w-]*/.test(text)) return true;
  if (/^\s*[-*]\s+/.test(text)) return true;
  return isProseSentence(text);
}

function isDocumentationLine(text: string): boolean {
  if (/^@[A-Za-z][\w-]*/.test(text)) return true;
  if (/^\{?@[A-Za-z][\w-]*/.test(text)) return true;
  if (isBlockDelimiterLine(text)) return true;
  if (isSeparatorLine(text)) return true;
  return isProseOnly(text) || /^[A-Za-z0-9_`'"()[\]\s.,:;!?/@{}|&<>#-]+$/.test(text);
}

function isBlockDelimiterLine(text: string): boolean {
  return /^(?:\/?\*\*?\/?|\/)$/.test(text);
}

function isSeparatorRun(run: CommentRun): boolean {
  const meaningful = run.lines
    .map((line) => line.text.trim())
    .filter(Boolean);
  if (meaningful.length === 0) return false;
  if (!meaningful.some((line) => isSeparatorLine(line))) return false;

  return meaningful.every((line) => isSeparatorLine(line) || isSeparatorLabelLine(line));
}

function isSeparatorLine(text: string): boolean {
  return /^[\s\-_=*#/|.]+$/.test(text) && /[-_=*#/|.]{3,}/.test(text);
}

function isSeparatorLabelLine(text: string): boolean {
  if (/\b(?:const|let|var|function|import|return|class|export|async|await)\b/.test(text)) return false;
  if (/[;{}=<>]/.test(text)) return false;
  return /^[A-Za-z][A-Za-z0-9\s.,:/()+_-]+$/.test(text) && text.includes(":");
}

function isCodeLikeComment(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isProseOnly(trimmed)) return false;
  return looksLikeCode(trimmed);
}

function looksLikeCode(text: string): boolean {
  if (/^[})\]]\s*[;,]?$/.test(text)) return true;
  if (/^(?:const|let|var|function|import|export|return|throw|class|type|interface|enum|await)\b/.test(text)) return true;
  if (/^(?:async\s+function|async\s*\(|async\s+[A-Za-z_$][\w$]*\s*=>)\b/.test(text)) return true;
  if (/^(?:if|for|while|switch|catch|with)\s*\(/.test(text)) return true;
  if (/^(?:try|else|finally)\b/.test(text)) return true;
  if (/=>/.test(text)) return true;
  if (/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=/.test(text)) return true;
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\([^)]*\)\s*;?$/.test(text)) return true;
  return /[;{}]$/.test(text) && /[A-Za-z_$][\w$]*\s*(?:=|\(|=>)|\b(?:return|import|export)\b/.test(text);
}

function isProseOnly(text: string): boolean {
  if (looksLikeCode(text)) return false;
  if (/[;{}()[\]=<>]/.test(text)) return false;
  return /^[\s"A-Za-z0-9_,.'!?-]+$/.test(text) && /\s/.test(text);
}

function isProseSentence(text: string): boolean {
  if (looksLikeCode(text)) return false;
  return /^[A-Z`"'][\s\w`'"()[\].,:;!?/@{}|&<>=#-]+[.!?:)]?$/.test(text)
    && /\s/.test(text);
}

function confidenceForRunLength(runLength: number, minLines: number): number {
  const extraLines = Math.max(0, runLength - minLines);
  return Math.min(0.8, 0.6 + extraLines * 0.04);
}
