import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { countKotlinBranches, extractKotlinFunctions } from "./parse.js";

export const kotlinLargeFunctionDetector: Detector = {
  id: "kotlin-large-function",
  name: "Kotlin large function",
  description: "Flags Kotlin functions that exceed line or branch-count budgets.",
  defaultSeverity: "medium",
  tags: ["kotlin", "complexity", "maintainability"],
  languages: ["kotlin"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxLines = context.getThreshold("large-function.maxLines", 120);
    const maxBranches = context.getThreshold("large-function.maxBranches", 12);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      for (const fn of extractKotlinFunctions(file)) {
        if (fn.annotations.some((annotation) => /@Composable\b/.test(annotation))) continue;
        const lines = fn.endLine - fn.startLine + 1;
        const branches = countKotlinBranches(fn);
        if (lines <= maxLines && branches <= maxBranches) continue;
        const exceededLines = lines > maxLines;
        const exceededBranches = branches > maxBranches;

        const reasons = [
          ...(exceededLines ? [`${lines} lines > ${maxLines}`] : []),
          ...(exceededBranches ? [`${branches} branch points > ${maxBranches}`] : []),
        ];

        issues.push(createIssue({
          detector: kotlinLargeFunctionDetector,
          severity: exceededLines && exceededBranches ? "high" : "medium",
          confidence: exceededLines ? 0.82 : 0.76,
          file: file.relativePath,
          location: { startLine: fn.startLine, endLine: fn.endLine },
          message: `${fn.name} is a large Kotlin function (${reasons.join(", ")}).`,
          evidence: [
            `${fn.name}: ${lines} lines, ${branches} branch points`,
          ],
          suggestion: "Split orchestration, branching policy, and data shaping into smaller Kotlin functions before adding more cases.",
        }));
      }
    }

    return issues;
  },
};
