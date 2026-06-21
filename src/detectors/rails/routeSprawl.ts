import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractRailsRoutes } from "./parse.js";

export const railsRouteSprawlDetector: Detector = {
  id: "rails-route-sprawl",
  name: "Rails route sprawl",
  description: "Flags Rails routes.rb files that register too many routes in one module.",
  defaultSeverity: "medium",
  tags: ["rails", "routes", "framework", "module-boundaries"],
  languages: ["ruby"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxRoutes = context.getThreshold("rails-route-sprawl.maxRoutes", 8);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      const routes = extractRailsRoutes(file);
      if (routes.length < maxRoutes) continue;
      const span = fileLineSpan(file);

      issues.push(createIssue({
        detector: railsRouteSprawlDetector,
        severity: routes.length >= maxRoutes * 1.5 ? "high" : "medium",
        confidence: 0.78,
        file: file.relativePath,
        location: { startLine: span.startLine, endLine: span.endLine },
        message: `${file.relativePath} registers ${routes.length} Rails routes in one file.`,
        evidence: routes
          .slice(0, 10)
          .map((route) => `${route.method} ${route.path} at line ${route.line}`),
        suggestion: "Split routes by resource, namespace, or engine boundary so one routes file does not own too many endpoints.",
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
