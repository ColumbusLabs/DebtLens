import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { countSwiftBranches, extractSwiftFunctions } from "./parse.js";

export const swiftLargeFunctionDetector: Detector = {
  id: "swift-large-function",
  name: "Swift large function",
  description: "Flags Swift functions that exceed line or branch-count budgets.",
  defaultSeverity: "medium",
  tags: ["swift", "complexity", "maintainability"],
  languages: ["swift"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxLines = context.getThreshold("large-function.maxLines", 120);
    const maxBranches = context.getThreshold("large-function.maxBranches", 12);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      for (const fn of extractSwiftFunctions(file)) {
        if (fn.parentViewStruct || fn.isViewBody || fn.attributes.some((attribute) => /@ViewBuilder\b/.test(attribute))) continue;
        const lines = fn.endLine - fn.startLine + 1;
        const branches = countSwiftBranches(fn);
        if (lines <= maxLines && branches <= maxBranches) continue;
        const exceededLines = lines > maxLines;
        const exceededBranches = branches > maxBranches;

        const reasons = [
          ...(exceededLines ? [`${lines} lines > ${maxLines}`] : []),
          ...(exceededBranches ? [`${branches} branch points > ${maxBranches}`] : []),
        ];

        issues.push(createIssue({
          detector: swiftLargeFunctionDetector,
          severity: exceededLines && exceededBranches ? "high" : "medium",
          confidence: exceededLines ? 0.82 : 0.76,
          file: file.relativePath,
          location: { startLine: fn.startLine, endLine: fn.endLine },
          message: `${fn.name} is a large Swift function (${reasons.join(", ")}).`,
          evidence: [
            `${fn.name}: ${lines} lines, ${branches} branch points`,
          ],
          suggestion: "Split orchestration, branching policy, and data shaping into smaller Swift functions before adding more cases.",
        }));
      }
    }

    return issues;
  },
};
