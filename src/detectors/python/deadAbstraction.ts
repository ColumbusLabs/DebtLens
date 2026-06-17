import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractPythonFunctions, splitPythonArgs, type PythonFunction } from "./parse.js";

export const pythonDeadAbstractionDetector: Detector = {
  id: "python-dead-abstraction",
  name: "Python dead abstraction",
  description: "Flags Python functions that only pass parameters through to another function.",
  defaultSeverity: "low",
  tags: ["python", "abstraction", "cleanup"],
  languages: ["python"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxWrapperLines = context.getThreshold("dead-abstraction.maxWrapperLines", 8);

    for (const file of context.files) {
      for (const fn of extractPythonFunctions(file)) {
        const lines = fn.endLine - fn.startLine + 1;
        if (lines > maxWrapperLines) continue;
        const wrapper = describePythonWrapper(fn);
        if (!wrapper) continue;

        issues.push(createIssue({
          detector: pythonDeadAbstractionDetector,
          severity: "low",
          confidence: wrapper.confidence,
          file: file.relativePath,
          location: { startLine: fn.startLine, endLine: fn.endLine },
          message: `${fn.name} looks like a thin Python wrapper: ${wrapper.description}.`,
          evidence: [fn.text.replace(/\s+/g, " ").slice(0, 180)],
          suggestion: "Keep the wrapper only if it creates a stable domain boundary. Otherwise inline it or add the missing behavior where this abstraction belongs.",
        }));
      }
    }

    return issues;
  },
};

function describePythonWrapper(fn: PythonFunction): { description: string; confidence: number } | undefined {
  const significant = fn.bodyLines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !/^\s*@/.test(line));
  if (significant.length !== 1) return undefined;

  const line = significant[0] ?? "";
  const match = line.match(/^(?:return\s+)?(?:await\s+)?([A-Za-z_][\w.]*)\((.*)\)$/);
  if (!match) return undefined;
  const callee = match[1] ?? "";
  const args = splitPythonArgs(match[2] ?? "");
  const params = fn.params[0] === "self" ? fn.params.slice(1) : fn.params;
  if (args.length !== params.length || !args.every((arg, index) => arg === params[index])) return undefined;
  return { description: `it only delegates to ${callee}(...)`, confidence: 0.8 };
}
