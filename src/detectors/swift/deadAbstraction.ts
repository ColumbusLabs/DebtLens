import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractSwiftFunctions, splitSwiftArgs, type SwiftFunction } from "./parse.js";

export const swiftDeadAbstractionDetector: Detector = {
  id: "swift-dead-abstraction",
  name: "Swift dead abstraction",
  description: "Flags Swift functions that only pass parameters through to another function.",
  defaultSeverity: "low",
  tags: ["swift", "abstraction", "cleanup"],
  languages: ["swift"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxWrapperLines = context.getThreshold("dead-abstraction.maxWrapperLines", 8);

    for (const file of context.files) {
      for (const fn of extractSwiftFunctions(file)) {
        const lines = fn.endLine - fn.startLine + 1;
        if (lines > maxWrapperLines) continue;
        if (shouldSkipWrapper(fn)) continue;
        const wrapper = describeSwiftWrapper(fn);
        if (!wrapper) continue;

        issues.push(createIssue({
          detector: swiftDeadAbstractionDetector,
          severity: "low",
          confidence: wrapper.confidence,
          file: file.relativePath,
          location: { startLine: fn.startLine, endLine: fn.endLine },
          message: `${fn.name} looks like a thin Swift wrapper: ${wrapper.description}.`,
          evidence: [fn.text.replace(/\s+/g, " ").slice(0, 180)],
          suggestion: "Keep the wrapper only if it creates a stable domain boundary. Otherwise inline it or add the missing behavior where this abstraction belongs.",
        }));
      }
    }

    return issues;
  },
};

function describeSwiftWrapper(fn: SwiftFunction): { description: string; confidence: number } | undefined {
  const significant = fn.expressionBody
    ? [fn.expressionBody.trim()]
    : fn.bodyLines
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//") && !line.startsWith("/*") && line !== "}");
  if (significant.length !== 1) return undefined;

  const line = significant[0] ?? "";
  const match = line.match(/^(?:return\s+)?([A-Za-z_][\w.]*)\((.*)\)$/);
  if (!match) return undefined;
  const callee = match[1] ?? "";
  const args = splitSwiftArgs(match[2] ?? "");
  const params = fn.params;
  if (args.length !== params.length || !args.every((arg, index) => arg === params[index])) return undefined;
  return { description: `it only delegates to ${callee}(...)`, confidence: fn.expressionBody ? 0.86 : 0.82 };
}

function shouldSkipWrapper(fn: SwiftFunction): boolean {
  return fn.modifiers.includes("override")
    || Boolean(fn.parentViewStruct)
    || fn.isViewBody
    || fn.attributes.some((attribute) => /@(?:State|Binding|ObservedObject|StateObject|FocusState|Preview)\b/.test(attribute));
}
