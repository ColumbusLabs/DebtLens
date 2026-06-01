import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { collectFunctionLikes, countBranches, countHookCalls, getFunctionBody } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

export const largeComponentDetector: Detector = {
  id: "large-component",
  name: "Large component",
  description: "Flags React-style components that have grown large enough to hide unrelated responsibilities.",
  defaultSeverity: "medium",
  tags: ["react", "maintainability", "component-design"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxLines = context.getThreshold("large-component.maxLines", 250);
    const maxBranches = context.getThreshold("large-component.maxBranches", 16);
    const maxHooks = context.getThreshold("large-component.maxHooks", 10);

    for (const file of context.files) {
      for (const fn of collectFunctionLikes(file)) {
        if (fn.classification !== "component") continue;
        const body = getFunctionBody(fn.node) ?? fn.node;
        const span = nodeLineSpan(body);
        const branchCount = countBranches(body);
        const hookCount = countHookCalls(body);
        const isOverLineBudget = span.lines >= maxLines;
        const isOverComplexityBudget = branchCount >= maxBranches || hookCount >= maxHooks;

        if (!isOverLineBudget && !isOverComplexityBudget) continue;

        issues.push(createIssue({
          detector: largeComponentDetector,
          severity: isOverLineBudget && isOverComplexityBudget ? "high" : "medium",
          confidence: isOverLineBudget ? 0.86 : 0.74,
          file: file.relativePath,
          location: { startLine: span.startLine, endLine: span.endLine },
          message: `${fn.name} appears to own too many responsibilities. It spans ${span.lines} lines, uses ${hookCount} hooks, and contains ${branchCount} branch points.`,
          evidence: [
            `Lines: ${span.lines} / ${maxLines}`,
            `Hook calls: ${hookCount} / ${maxHooks}`,
            `Branch points: ${branchCount} / ${maxBranches}`,
          ],
          suggestion: "Extract data loading, derived state, or rendering sections into focused hooks/components before adding more behavior.",
        }));
      }
    }

    return issues;
  },
};
