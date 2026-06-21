import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractInstructionBlocks, resolveInstructionFiles } from "./parse.js";

interface DirectiveMatch {
  file: string;
  text: string;
  startLine: number;
  side: "left" | "right";
}

interface ContradictionPair {
  label: string;
  left: RegExp;
  right: RegExp;
}

const CONTRADICTION_PAIRS: ContradictionPair[] = [
  {
    label: "test execution policy",
    left: /\balways\s+run\b[^.!\n]{0,40}\btests?\b/i,
    right: /\b(skip|do not run|don't run|never run)\b[^.!\n]{0,40}\btests?\b/i,
  },
  {
    label: "test execution policy",
    left: /\brun\b[^.!\n]{0,30}\btests?\b[^.!\n]{0,30}\bbefore\b/i,
    right: /\bskip\s+tests?\b/i,
  },
  {
    label: "formatting policy",
    left: /\balways\s+(run|apply)\b[^.!\n]{0,40}\b(format|prettier|lint)\b/i,
    right: /\b(skip|do not run|don't run|never run)\b[^.!\n]{0,40}\b(format|prettier|lint)\b/i,
  },
  {
    label: "commit review policy",
    left: /\bnever\s+commit\b[^.!\n]{0,40}\bwithout\b/i,
    right: /\bcommit\b[^.!\n]{0,40}\bwithout\b[^.!\n]{0,40}\b(review|approval)\b/i,
  },
];

export const instructionContradictionDetector: Detector = {
  id: "ai-instruction-contradiction",
  name: "AI instruction contradiction",
  description: "Flags conservative opposing directives across AI workflow instruction files.",
  defaultSeverity: "high",
  tags: ["ai-workflow", "maintainability", "documentation"],
  languages: ["tsjs"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxFiles = context.getThreshold("ai-instruction-contradiction.maxInstructionFiles", 50);
    const minBlockLength = context.getThreshold("ai-instruction-contradiction.minBlockLength", 24);
    const issues: DebtIssue[] = [];
    const seen = new Set<string>();

    const blocks = resolveInstructionFiles(context, maxFiles).flatMap((file) =>
      extractInstructionBlocks(file.content, minBlockLength).map((block) => ({
        file: file.relativePath,
        text: block.text,
        startLine: block.startLine,
      })));

    for (const pair of CONTRADICTION_PAIRS) {
      const leftMatches = blocks.filter((block) => pair.left.test(block.text));
      const rightMatches = blocks.filter((block) => matchesContradictionSide(pair.right, block.text));
      if (leftMatches.length === 0 || rightMatches.length === 0) continue;

      for (const left of leftMatches) {
        for (const right of rightMatches) {
          if (left.file === right.file && left.startLine === right.startLine) continue;
          const fingerprint = [
            pair.label,
            left.file,
            left.startLine,
            right.file,
            right.startLine,
          ].join("|");
          if (seen.has(fingerprint)) continue;
          seen.add(fingerprint);

          issues.push(createIssue({
            detector: instructionContradictionDetector,
            confidence: 0.8,
            file: left.file,
            location: { startLine: left.startLine },
            message: `Conflicting AI workflow directives detected for ${pair.label}.`,
            evidence: [
              `${left.file}:${left.startLine} — ${summarize(left.text)}`,
              `${right.file}:${right.startLine} — ${summarize(right.text)}`,
            ],
            suggestion: "Reconcile the instruction files so assistants receive one consistent policy.",
          }));
        }
      }
    }

    return issues.slice(0, 50);
  },
};

function summarize(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length <= 100 ? singleLine : `${singleLine.slice(0, 97)}...`;
}

function matchesContradictionSide(pattern: RegExp, text: string): boolean {
  const match = pattern.exec(text);
  if (!match) return false;
  const prefix = text.slice(0, match.index).trimEnd();
  return !/\b(?:do not|don't|never|not)\s*$/i.test(prefix);
}
