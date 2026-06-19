import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { containsTrackerLink } from "../../utils/strings.js";
import { resolveTodoCommentPatterns } from "../todoComment.js";
import { extractKotlinCommentSegments } from "./parse.js";

export const kotlinTodoCommentDetector: Detector = {
  id: "kotlin-todo-comment",
  name: "Kotlin debt marker comment",
  description: "Finds TODO/FIXME-style debt markers in Kotlin comments.",
  defaultSeverity: "low",
  tags: ["kotlin", "comments", "cleanup"],
  languages: ["kotlin"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const patterns = resolveTodoCommentPatterns(context);

    for (const file of context.files) {
      let countForFile = 0;
      for (const comment of extractKotlinCommentSegments(file)) {
        if (/debtlens-disable-(?:next-line|file)/i.test(comment.text)) continue;
        const match = patterns.find((pattern) => pattern.regex.test(comment.text));
        if (!match) continue;
        const hasTrackerLink = containsTrackerLink(comment.text);

        issues.push(createIssue({
          detector: kotlinTodoCommentDetector,
          severity: match.severity,
          confidence: hasTrackerLink ? 0.96 : 0.9,
          file: file.relativePath,
          location: { startLine: comment.line },
          message: `Kotlin comment contains a ${match.label}.`,
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
