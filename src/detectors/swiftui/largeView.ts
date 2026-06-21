import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractSwiftViewStructs } from "../swift/parse.js";
import { collectSwiftUIStateHolders, countSwiftUIBranches, isPreviewView, isSwiftUIView } from "./parse.js";

export const swiftuiLargeViewDetector: Detector = {
  id: "swiftui-large-view",
  name: "Large SwiftUI view",
  description: "Flags SwiftUI views that have grown large or branch-heavy enough to hide unrelated UI responsibilities.",
  defaultSeverity: "medium",
  tags: ["swiftui", "swift", "ui", "maintainability"],
  languages: ["swift"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxLines = context.getThreshold("swiftui-large-view.maxLines", 90);
    const maxBranches = context.getThreshold("swiftui-large-view.maxBranches", 12);
    const maxLocalState = context.getThreshold("swiftui-large-view.maxLocalState", 6);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      for (const view of extractSwiftViewStructs(file)) {
        if (!isSwiftUIView(view) || isPreviewView(view, file.content, view.startLine)) continue;
        const lines = view.bodyEndLine - view.bodyStartLine + 1;
        const branches = countSwiftUIBranches(view);
        const localState = collectSwiftUIStateHolders(view).length;
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
          detector: swiftuiLargeViewDetector,
          severity: exceededLines && (exceededBranches || exceededLocalState) ? "high" : "medium",
          confidence: exceededLines ? 0.84 : 0.76,
          file: file.relativePath,
          location: { startLine: view.bodyStartLine, endLine: view.bodyEndLine },
          message: `${view.name} is a large SwiftUI view (${reasons.join(", ")}).`,
          evidence: [
            `${view.name}: ${lines} lines, ${branches} branch points, ${localState} local state holders`,
          ],
          suggestion: "Split durable state, conditional sections, and repeated UI regions into smaller views or observable models before adding more screen behavior.",
        }));
      }
    }

    return issues;
  },
};
