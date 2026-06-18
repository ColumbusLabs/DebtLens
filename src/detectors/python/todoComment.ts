import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { containsTrackerLink } from "../../utils/strings.js";
import { resolveTodoCommentPatterns } from "../todoComment.js";

export const pythonTodoCommentDetector: Detector = {
  id: "python-todo-comment",
  name: "Python debt marker comment",
  description: "Finds TODO/FIXME-style debt markers in Python comments.",
  defaultSeverity: "low",
  tags: ["python", "comments", "cleanup"],
  languages: ["python"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const patterns = resolveTodoCommentPatterns(context);

    for (const file of context.files) {
      const lines = file.content.split(/\r?\n/);
      let countForFile = 0;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const commentIndex = line.indexOf("#");
        if (commentIndex < 0) continue;
        const comment = line.slice(commentIndex);
        if (/debtlens-disable-(?:next-line|file)/i.test(comment)) continue;
        const match = patterns.find((pattern) => pattern.regex.test(comment));
        if (!match) continue;
        const hasTrackerLink = containsTrackerLink(comment);

        issues.push(createIssue({
          detector: pythonTodoCommentDetector,
          severity: match.severity,
          confidence: hasTrackerLink ? 0.96 : 0.9,
          file: file.relativePath,
          location: { startLine: index + 1 },
          message: `Python comment contains a ${match.label}.`,
          evidence: [
            comment.trim().slice(0, 220),
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
