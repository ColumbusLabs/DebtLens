import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { maskKotlinTrivia } from "./parse.js";

const MAX_FINDINGS_PER_FILE = 12;

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
      const lines = file.content.split(/\r?\n/);

      for (const catchBlock of findAllKotlinCatchBlocks(lines)) {
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

function findAllKotlinCatchBlocks(lines: string[]): KotlinCatchBlock[] {
  const text = lines.join("\n");
  const masked = maskKotlinTrivia(text);
  const blocks: KotlinCatchBlock[] = [];
  const catchPattern = /\bcatch\s*\(/g;
  let match = catchPattern.exec(masked);

  while (match) {
    const block = parseKotlinCatchBlock(text, masked, match.index);
    if (block) blocks.push(block);
    match = catchPattern.exec(masked);
  }

  return blocks;
}

function parseKotlinCatchBlock(text: string, code: string, catchIndex: number): KotlinCatchBlock | undefined {
  const braceIndex = code.indexOf("{", catchIndex);
  if (braceIndex < 0) return undefined;

  const endOffset = findMatchingBraceEnd(code, braceIndex);
  if (endOffset < 0) return undefined;

  const blockText = text.slice(catchIndex, endOffset + 1);
  const bodyText = blockText.slice(blockText.indexOf("{") + 1, blockText.lastIndexOf("}"));
  const catchLine = countLineBreaks(text.slice(0, catchIndex)) + 1;
  const endLine = countLineBreaks(text.slice(0, endOffset + 1)) + 1;

  return {
    catchLine,
    endLine,
    bodyText,
  };
}

function classifyKotlinCatchBody(bodyText: string): CatchBodyClassification {
  const withoutTrivia = maskKotlinTrivia(bodyText).trim();

  if (!withoutTrivia) {
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

function countLineBreaks(text: string): number {
  return text.match(/\n/g)?.length ?? 0;
}
