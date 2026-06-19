import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { analyzePythonControlFlow } from "./complexity.js";
import { extractPythonFunctions } from "./parse.js";

export const pythonLargeFunctionDetector: Detector = {
  id: "python-large-function",
  name: "Python large function",
  description: "Flags Python functions that exceed line or branch-count budgets.",
  defaultSeverity: "medium",
  tags: ["python", "complexity", "maintainability", "function-design"],
  languages: ["python"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxLines = context.getThreshold("large-function.maxLines", 120);
    const maxBranches = context.getThreshold("large-function.maxBranches", 12);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      for (const fn of extractPythonFunctions(file)) {
        const lines = fn.endLine - fn.startLine + 1;
        const branches = analyzePythonControlFlow(fn).branches;
        if (lines <= maxLines && branches <= maxBranches) continue;
        const exceededLines = lines > maxLines;
        const exceededBranches = branches > maxBranches;
        const reasons = [
          ...(exceededLines ? [`${lines} lines > ${maxLines}`] : []),
          ...(exceededBranches ? [`${branches} branch points > ${maxBranches}`] : []),
        ];

        issues.push(createIssue({
          detector: pythonLargeFunctionDetector,
          severity: exceededLines && exceededBranches ? "high" : "medium",
          confidence: exceededLines ? 0.82 : 0.76,
          file: file.relativePath,
          location: { startLine: fn.startLine, endLine: fn.endLine },
          message: `${fn.name} is a large Python function (${reasons.join(", ")}).`,
          evidence: [
            `${fn.name}: ${lines} lines, ${branches} branch points`,
          ],
          suggestion: "Split orchestration, branching policy, and data shaping into smaller Python functions before adding more cases.",
        }));
      }
    }

    return issues;
  },
};
