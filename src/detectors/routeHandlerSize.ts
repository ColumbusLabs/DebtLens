import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../core/types.js";
import { countBranches } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { countLines, nodeLineSpan } from "../utils/lines.js";
import { SyntaxKind } from "ts-morph";

export const routeHandlerSizeDetector: Detector = {
  id: "route-handler-size",
  name: "Route handler size",
  description: "Flags oversized Next.js route and page modules that mix routing with too much workflow logic.",
  defaultSeverity: "medium",
  tags: ["next", "routing", "complexity", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxLines = context.getThreshold("route-handler-size.maxLines", 220);
    const maxBranches = context.getThreshold("route-handler-size.maxBranches", 14);
    const maxAwaits = context.getThreshold("route-handler-size.maxAwaits", 6);

    for (const file of context.files) {
      if (!isNextRouteOrPageModule(file)) continue;

      const lines = countLines(file.content.trim());
      const branches = countBranches(file.sourceFile);
      const awaits = file.sourceFile.getDescendantsOfKind(SyntaxKind.AwaitExpression).length;
      const overLines = lines >= maxLines;
      const overBranches = branches >= maxBranches;
      const overAwaits = awaits >= maxAwaits;
      if (!overLines && !overBranches && !overAwaits) continue;

      const span = nodeLineSpan(file.sourceFile);
      const exceededCount = [overLines, overBranches, overAwaits].filter(Boolean).length;
      issues.push(createIssue({
        detector: routeHandlerSizeDetector,
        severity: exceededCount >= 2 || lines >= maxLines * 1.5 ? "high" : "medium",
        confidence: exceededCount >= 2 ? 0.86 : 0.76,
        file: file.relativePath,
        location: { startLine: span.startLine, endLine: span.endLine },
        message: `${file.relativePath} is doing too much inside a Next.js route/page module.`,
        evidence: [
          `Lines: ${lines} / ${maxLines}`,
          `Branch points: ${branches} / ${maxBranches}`,
          `Await expressions: ${awaits} / ${maxAwaits}`,
        ],
        suggestion: "Keep the route/page module thin by moving validation, orchestration, and data access into focused server-side helpers.",
      }));
    }

    return issues;
  },
};

function isNextRouteOrPageModule(file: SourceFileInfo): boolean {
  const path = normalizePath(file.relativePath);
  if (/\.d\.[cm]?[jt]s$/.test(path)) return false;
  if (!/\.[cm]?[jt]sx?$/.test(path)) return false;

  if (/(^|\/)app\/.*\/(route|page)\.[cm]?[jt]sx?$/.test(path)) return true;
  if (/(^|\/)pages\/api\/.+\.[cm]?[jt]sx?$/.test(path)) return true;
  if (/(^|\/)pages\/(?!api\/|_app\.|_document\.|_error\.).+\.[cm]?[jt]sx?$/.test(path)) return true;

  return false;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
