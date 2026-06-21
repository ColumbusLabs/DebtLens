import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { countRubyBranches, extractRubyFunctions } from "./parse.js";

export const rubyLargeFunctionDetector: Detector = {
  id: "ruby-large-function",
  name: "Ruby large function",
  description: "Flags Ruby methods that exceed line or branch-count budgets.",
  defaultSeverity: "medium",
  tags: ["ruby", "complexity", "maintainability"],
  languages: ["ruby"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxLines = context.getThreshold("large-function.maxLines", 120);
    const maxBranches = context.getThreshold("large-function.maxBranches", 12);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      for (const fn of extractRubyFunctions(file)) {
        const lines = fn.endLine - fn.startLine + 1;
        const branches = countRubyBranches(fn);
        if (lines <= maxLines && branches <= maxBranches) continue;
        const exceededLines = lines > maxLines;
        const exceededBranches = branches > maxBranches;

        const reasons = [
          ...(exceededLines ? [`${lines} lines > ${maxLines}`] : []),
          ...(exceededBranches ? [`${branches} branch points > ${maxBranches}`] : []),
        ];

        issues.push(createIssue({
          detector: rubyLargeFunctionDetector,
          severity: exceededLines && exceededBranches ? "high" : "medium",
          confidence: exceededLines ? 0.82 : 0.76,
          file: file.relativePath,
          location: { startLine: fn.startLine, endLine: fn.endLine },
          message: `${fn.name} is a large Ruby method (${reasons.join(", ")}).`,
          evidence: [
            `${fn.name}: ${lines} lines, ${branches} branch points`,
          ],
          suggestion: "Split orchestration, branching policy, and data shaping into smaller Ruby methods before adding more cases.",
        }));
      }
    }

    return issues;
  },
};
