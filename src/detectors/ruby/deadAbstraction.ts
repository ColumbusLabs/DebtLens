import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractRubyFunctions, splitRubyArgs, type RubyFunction } from "./parse.js";

export const rubyDeadAbstractionDetector: Detector = {
  id: "ruby-dead-abstraction",
  name: "Ruby dead abstraction",
  description: "Flags Ruby methods that only pass parameters through to another method.",
  defaultSeverity: "low",
  tags: ["ruby", "abstraction", "cleanup"],
  languages: ["ruby"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxWrapperLines = context.getThreshold("dead-abstraction.maxWrapperLines", 8);

    for (const file of context.files) {
      for (const fn of extractRubyFunctions(file)) {
        const lines = fn.endLine - fn.startLine + 1;
        if (lines > maxWrapperLines) continue;
        if (shouldSkipWrapper(fn)) continue;
        const wrapper = describeRubyWrapper(fn);
        if (!wrapper) continue;

        issues.push(createIssue({
          detector: rubyDeadAbstractionDetector,
          severity: "low",
          confidence: wrapper.confidence,
          file: file.relativePath,
          location: { startLine: fn.startLine, endLine: fn.endLine },
          message: `${fn.name} looks like a thin Ruby wrapper: ${wrapper.description}.`,
          evidence: [fn.text.replace(/\s+/g, " ").slice(0, 180)],
          suggestion: "Keep the wrapper only if it creates a stable domain boundary. Otherwise inline it or add the missing behavior where this abstraction belongs.",
        }));
      }
    }

    return issues;
  },
};

function describeRubyWrapper(fn: RubyFunction): { description: string; confidence: number } | undefined {
  const significant = fn.expressionBody
    ? [fn.expressionBody.trim()]
    : fn.bodyLines
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line !== "end");
  if (significant.length !== 1) return undefined;

  const line = significant[0] ?? "";
  const match = line.match(/^(?:return\s+)?([A-Za-z_][\w.!?]*)\((.*)\)$/)
    ?? line.match(/^(?:return\s+)?([A-Za-z_][\w.!?]*)\s+(.+)$/);
  if (!match) return undefined;
  const callee = match[1] ?? "";
  const args = match[2]?.includes("(")
    ? splitRubyArgs(match[2] ?? "")
    : (match[2] ?? "").split(/\s+/).filter(Boolean);
  const params = fn.params;
  if (args.length !== params.length || !args.every((arg, index) => arg === params[index])) return undefined;
  return { description: `it only delegates to ${callee}(...)`, confidence: fn.expressionBody ? 0.86 : 0.82 };
}

function shouldSkipWrapper(fn: RubyFunction): boolean {
  return fn.visibility !== "public" || fn.modifiers.includes("private") || fn.name.startsWith("self.");
}
