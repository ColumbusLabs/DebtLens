import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { analyzePythonControlFlow } from "./complexity.js";
import { extractPythonFunctions } from "./parse.js";

export const pythonComplexControlFlowDetector: Detector = {
  id: "python-complex-control-flow",
  name: "Python complex control flow",
  description: "Flags Python functions whose branching and nesting make behavior hard to review.",
  defaultSeverity: "medium",
  tags: ["python", "complexity", "maintainability", "review"],
  languages: ["python"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxComplexity = context.getThreshold("complex-control-flow.maxComplexity", 12);
    const maxDepth = context.getThreshold("complex-control-flow.maxDepth", 4);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      for (const fn of extractPythonFunctions(file, { addWarning: context.addWarning })) {
        const { complexity, maxDepth: depth } = analyzePythonControlFlow(fn);
        if (complexity < maxComplexity && depth < maxDepth) continue;
        const overage = Math.max(complexity / maxComplexity, depth / maxDepth);

        issues.push(createIssue({
          detector: pythonComplexControlFlowDetector,
          severity: overage >= 1.5 ? "high" : "medium",
          confidence: Math.min(0.95, 0.64 + (overage - 1) * 0.28),
          file: file.relativePath,
          location: { startLine: fn.startLine, endLine: fn.endLine },
          message: `${fn.name} has complex Python control flow with score ${complexity} and nesting depth ${depth}.`,
          evidence: [
            `Complexity score: ${complexity} / ${maxComplexity}`,
            `Max nesting depth: ${depth} / ${maxDepth}`,
          ],
          suggestion: "Extract decision tables, guard clauses, or focused helpers so each branch can be reviewed independently.",
        }));
      }
    }

    return issues;
  },
};
