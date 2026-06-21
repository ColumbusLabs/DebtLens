import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { containsTrackerLink } from "../../utils/strings.js";
import { resolveTodoCommentPatterns } from "../todoComment.js";
import { extractSwiftCommentSegments } from "./parse.js";

export const swiftTodoCommentDetector: Detector = {
  id: "swift-todo-comment",
  name: "Swift debt marker comment",
  description: "Finds TODO/FIXME-style debt markers in Swift comments.",
  defaultSeverity: "low",
  tags: ["swift", "comments", "cleanup"],
  languages: ["swift"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const patterns = resolveTodoCommentPatterns(context);

    for (const file of context.files) {
      let countForFile = 0;
      for (const comment of extractSwiftCommentSegments(file)) {
        if (/debtlens-disable-(?:next-line|file)/i.test(comment.text)) continue;
        const match = patterns.find((pattern) => pattern.regex.test(comment.text));
        if (!match) continue;
        const hasTrackerLink = containsTrackerLink(comment.text);

        issues.push(createIssue({
          detector: swiftTodoCommentDetector,
          severity: match.severity,
          confidence: hasTrackerLink ? 0.96 : 0.9,
          file: file.relativePath,
          location: { startLine: comment.line },
          message: `Swift comment contains a ${match.label}.`,
          evidence: [
            comment.text.trim().slice(0, 220),
            ...(hasTrackerLink ? ["Tracker-linked marker detected"] : []),
          ],
          suggestion: "Convert the marker into a tracked issue, add a removal condition, or fix it before more code depends on it.",
        }));

        countForFile += 1;
        if (countForFile >= 12) break;
      }
    }

    return issues;
  },
};
