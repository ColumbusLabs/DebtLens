import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractRailsControllerActions } from "./parse.js";

export const railsControllerSprawlDetector: Detector = {
  id: "rails-controller-sprawl",
  name: "Rails controller sprawl",
  description: "Flags Rails controllers that declare too many public actions in one class.",
  defaultSeverity: "medium",
  tags: ["rails", "controllers", "framework", "module-boundaries"],
  languages: ["ruby"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxActions = context.getThreshold("rails-controller-sprawl.maxActions", 8);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      const actions = extractRailsControllerActions(file);
      if (actions.length < maxActions) continue;
      const span = fileLineSpan(file);

      issues.push(createIssue({
        detector: railsControllerSprawlDetector,
        severity: actions.length >= maxActions * 1.5 ? "high" : "medium",
        confidence: 0.8,
        file: file.relativePath,
        location: { startLine: span.startLine, endLine: span.endLine },
        message: `${file.relativePath} declares ${actions.length} public controller actions.`,
        evidence: actions
          .slice(0, 10)
          .map((action) => `${action.name} at line ${action.line}`),
        suggestion: "Split controller actions by resource or workflow so one controller does not own too many endpoints.",
      }));
    }

    return issues;
  },
};

function fileLineSpan(file: SourceFileInfo): { startLine: number; endLine: number } {
  return {
    startLine: 1,
    endLine: Math.max(1, file.content.split(/\r?\n/).length),
  };
}
