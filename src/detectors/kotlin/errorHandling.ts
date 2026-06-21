import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";

const MAX_FINDINGS_PER_FILE = 12;
const disableNextLinePattern = /debtlens-disable-next-line\s+([a-z0-9-]+)(?:\s+--\s+(.+))?/i;
const disableFilePattern = /debtlens-disable-file\s+([a-z0-9-]+)(?:\s+--\s+(.+))?/i;

export const kotlinEmptyCatchDetector: Detector = {
  id: "kotlin-empty-catch",
  name: "Kotlin empty catch block",
  description: "Flags catch blocks that silently ignore errors without handling or rethrowing.",
  defaultSeverity: "medium",
  tags: ["kotlin", "error-handling", "maintainability", "review"],
  languages: ["kotlin"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      let countForFile = 0;
      const suppressedRules = parseFileSuppressions(file.content);
      const lines = file.content.split(/\r?\n/);

      for (const catchBlock of findAllKotlinCatchBlocks(lines)) {
        if (isSuppressed(suppressedRules, kotlinEmptyCatchDetector.id, catchBlock.catchLine)) continue;

        const classification = classifyKotlinCatchBody(catchBlock.bodyText);
        if (classification === "handled") continue;

        issues.push(createKotlinEmptyCatchIssue(file.relativePath, catchBlock, classification));
        countForFile += 1;
        if (countForFile >= MAX_FINDINGS_PER_FILE) break;
      }
    }

    return issues;
  },
};

type CatchBodyClassification = "empty" | "comment-only" | "handled";

interface KotlinCatchBlock {
  catchLine: number;
  endLine: number;
  bodyText: string;
}

interface FileSuppressionRules {
  fileRules: Set<string>;
  nextLineRules: Map<number, Set<string>>;
  inlineLineRules: Map<number, Set<string>>;
}

function findAllKotlinCatchBlocks(lines: string[]): KotlinCatchBlock[] {
  const text = lines.join("\n");
  const masked = maskKotlinComments(text);
  const blocks: KotlinCatchBlock[] = [];
  const catchPattern = /\bcatch\s*\(/g;
  let match = catchPattern.exec(masked);

  while (match) {
    const lineIndex = countLineBreaks(text.slice(0, match.index));
    const block = parseKotlinCatchBlock(lines, lineIndex);
    if (block) blocks.push(block);
    match = catchPattern.exec(masked);
  }

  return blocks;
}

function parseKotlinCatchBlock(lines: string[], catchStartIndex: number): KotlinCatchBlock | undefined {
  const text = lines.slice(catchStartIndex).join("\n");
  const code = maskKotlinComments(text);
  const catchIndex = code.search(/\bcatch\s*\(/);
  if (catchIndex < 0) return undefined;

  const braceIndex = code.indexOf("{", catchIndex);
  if (braceIndex < 0) return undefined;

  const endOffset = findMatchingBraceEnd(code, braceIndex);
  if (endOffset < 0) return undefined;

  const blockText = text.slice(catchIndex, endOffset + 1);
  const bodyText = blockText.slice(blockText.indexOf("{") + 1, blockText.lastIndexOf("}"));
  const catchLine = catchStartIndex + countLineBreaks(text.slice(0, catchIndex)) + 1;
  const endLine = catchStartIndex + countLineBreaks(text.slice(0, endOffset + 1)) + 1;

  return {
    catchLine,
    endLine,
    bodyText,
  };
}

function classifyKotlinCatchBody(bodyText: string): CatchBodyClassification {
  const withoutComments = bodyText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n\r]*/g, "")
    .trim();

  if (!withoutComments) {
    return bodyText.trim() ? "comment-only" : "empty";
  }

  return "handled";
}

function createKotlinEmptyCatchIssue(
  file: string,
  catchBlock: KotlinCatchBlock,
  classification: CatchBodyClassification,
): DebtIssue {
  const detail = classification === "comment-only"
    ? "contains only comments"
    : "is empty";

  return createIssue({
    detector: kotlinEmptyCatchDetector,
    severity: "medium",
    confidence: 0.88,
    file,
    location: { startLine: catchBlock.catchLine, endLine: catchBlock.endLine },
    message: `Catch block ${detail} and silently ignores errors.`,
    evidence: [
      `Catch body: ${classification}`,
      `{${catchBlock.bodyText.trim().slice(0, 220)}}`,
    ],
    suggestion: "Handle the error explicitly, rethrow it, or document why ignoring it is safe.",
  });
}

function findMatchingBraceEnd(code: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < code.length; index += 1) {
    const char = code[index] ?? "";
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function maskKotlinComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (match) => " ".repeat(match.length))
    .replace(/\/\/[^\n\r]*/g, (match) => " ".repeat(match.length));
}

function countLineBreaks(text: string): number {
  return text.match(/\n/g)?.length ?? 0;
}

function parseFileSuppressions(content: string): FileSuppressionRules {
  const fileRules = new Set<string>();
  const nextLineRules = new Map<number, Set<string>>();
  const inlineLineRules = new Map<number, Set<string>>();
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;

    const fileMatch = line.match(disableFilePattern);
    if (fileMatch?.[1] && fileMatch[2]?.trim()) {
      fileRules.add(fileMatch[1].toLowerCase());
      inlineLineRules.set(lineNumber, addRule(inlineLineRules.get(lineNumber), fileMatch[1]));
      continue;
    }

    const nextLineMatch = line.match(disableNextLinePattern);
    if (!nextLineMatch?.[1] || !nextLineMatch[2]?.trim()) continue;

    const ruleId = nextLineMatch[1].toLowerCase();
    inlineLineRules.set(lineNumber, addRule(inlineLineRules.get(lineNumber), ruleId));
    nextLineRules.set(lineNumber + 1, addRule(nextLineRules.get(lineNumber + 1), ruleId));
  }

  return { fileRules, nextLineRules, inlineLineRules };
}

function addRule(existing: Set<string> | undefined, ruleId: string): Set<string> {
  const rules = existing ?? new Set<string>();
  rules.add(ruleId.toLowerCase());
  return rules;
}

function isSuppressed(rules: FileSuppressionRules, ruleId: string, line: number): boolean {
  const normalizedRuleId = ruleId.toLowerCase();
  if (rules.fileRules.has(normalizedRuleId)) return true;
  if (rules.nextLineRules.get(line)?.has(normalizedRuleId)) return true;
  if (rules.inlineLineRules.get(line)?.has(normalizedRuleId)) return true;
  return false;
}
