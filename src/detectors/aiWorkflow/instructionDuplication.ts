import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractInstructionBlocks, resolveInstructionFiles } from "./parse.js";

interface BlockOccurrence {
  file: string;
  text: string;
  startLine: number;
}

export const instructionDuplicationDetector: Detector = {
  id: "ai-instruction-duplication",
  name: "AI instruction duplication",
  description: "Flags the same normalized instruction block repeated across multiple AI workflow files.",
  defaultSeverity: "medium",
  tags: ["ai-workflow", "maintainability", "documentation"],
  languages: ["tsjs"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxFiles = context.getThreshold("ai-instruction-duplication.maxInstructionFiles", 50);
    const minBlockLength = context.getThreshold("ai-instruction-duplication.minBlockLength", 24);
    const occurrences = new Map<string, BlockOccurrence[]>();

    for (const file of resolveInstructionFiles(context, maxFiles)) {
      for (const block of extractInstructionBlocks(file.content, minBlockLength)) {
        const entries = occurrences.get(block.normalized) ?? [];
        entries.push({
          file: file.relativePath,
          text: block.text,
          startLine: block.startLine,
        });
        occurrences.set(block.normalized, entries);
      }
    }

    const issues: DebtIssue[] = [];
    for (const [normalized, entries] of occurrences) {
      const files = new Set(entries.map((entry) => entry.file));
      if (files.size < 2) continue;
      const first = entries[0];
      if (!first) continue;
      issues.push(createIssue({
        detector: instructionDuplicationDetector,
        severity: files.size > 2 ? "high" : "medium",
        confidence: 0.82,
        file: first.file,
        location: { startLine: first.startLine },
        message: "The same AI workflow instruction appears in multiple files.",
        evidence: [
          ...entries.map((entry) => `${entry.file}:${entry.startLine}`),
          `normalized: ${truncate(normalized, 120)}`,
        ],
        suggestion: "Keep one canonical instruction file and link to it from the others, or tailor each file to its tool-specific context.",
      }));
    }

    return issues.slice(0, 50);
  },
};

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}
