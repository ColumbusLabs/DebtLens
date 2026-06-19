import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractKotlinFunctions } from "../kotlin/parse.js";
import { collectComposeStateHolders, countComposeBranches, isComposableFunction, isPreviewComposable } from "./parse.js";

export const composeLargeComposableDetector: Detector = {
  id: "compose-large-composable",
  name: "Large Compose composable",
  description: "Flags Jetpack Compose functions that have grown large or branch-heavy enough to hide unrelated UI responsibilities.",
  defaultSeverity: "medium",
  tags: ["compose", "kotlin", "ui", "maintainability"],
  languages: ["kotlin"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxLines = context.getThreshold("compose-large-composable.maxLines", 90);
    const maxBranches = context.getThreshold("compose-large-composable.maxBranches", 12);
    const maxLocalState = context.getThreshold("compose-large-composable.maxLocalState", 6);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      for (const fn of extractKotlinFunctions(file)) {
        if (!isComposableFunction(fn) || isPreviewComposable(fn)) continue;
        const lines = fn.endLine - fn.startLine + 1;
        const branches = countComposeBranches(fn);
        const localState = collectComposeStateHolders(fn).length;
        const exceededLines = lines > maxLines;
        const exceededBranches = branches > maxBranches;
        const exceededLocalState = localState > maxLocalState;
        if (!exceededLines && !exceededBranches && !exceededLocalState) continue;

        const reasons = [
          ...(exceededLines ? [`${lines} lines > ${maxLines}`] : []),
          ...(exceededBranches ? [`${branches} branch points > ${maxBranches}`] : []),
          ...(exceededLocalState ? [`${localState} local state holders > ${maxLocalState}`] : []),
        ];

        issues.push(createIssue({
          detector: composeLargeComposableDetector,
          severity: exceededLines && (exceededBranches || exceededLocalState) ? "high" : "medium",
          confidence: exceededLines ? 0.84 : 0.76,
          file: file.relativePath,
          location: { startLine: fn.startLine, endLine: fn.endLine },
          message: `${fn.name} is a large Compose composable (${reasons.join(", ")}).`,
          evidence: [
            `${fn.name}: ${lines} lines, ${branches} branch points, ${localState} local state holders`,
          ],
          suggestion: "Split durable state, conditional sections, and repeated UI regions into smaller composables or state holders before adding more screen behavior.",
        }));
      }
    }

    return issues;
  },
};
