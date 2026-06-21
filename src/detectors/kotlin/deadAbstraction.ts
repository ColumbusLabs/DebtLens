import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractKotlinFunctions, isKotlinSemanticNoopFunction, splitKotlinArgs, type KotlinFunction } from "./parse.js";

export const kotlinDeadAbstractionDetector: Detector = {
  id: "kotlin-dead-abstraction",
  name: "Kotlin dead abstraction",
  description: "Flags Kotlin functions that only pass parameters through to another function.",
  defaultSeverity: "low",
  tags: ["kotlin", "abstraction", "cleanup"],
  languages: ["kotlin"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxWrapperLines = context.getThreshold("dead-abstraction.maxWrapperLines", 8);

    for (const file of context.files) {
      for (const fn of extractKotlinFunctions(file)) {
        const lines = fn.endLine - fn.startLine + 1;
        if (lines > maxWrapperLines) continue;
        if (isKotlinSemanticNoopFunction(fn)) continue;
        if (shouldSkipWrapper(fn)) continue;
        const wrapper = describeKotlinWrapper(fn);
        if (!wrapper) continue;

        issues.push(createIssue({
          detector: kotlinDeadAbstractionDetector,
          severity: "low",
          confidence: wrapper.confidence,
          file: file.relativePath,
          location: { startLine: fn.startLine, endLine: fn.endLine },
          message: `${fn.name} looks like a thin Kotlin wrapper: ${wrapper.description}.`,
          evidence: [fn.text.replace(/\s+/g, " ").slice(0, 180)],
          suggestion: "Keep the wrapper only if it creates a stable domain boundary. Otherwise inline it or add the missing behavior where this abstraction belongs.",
        }));
      }
    }

    return issues;
  },
};

function describeKotlinWrapper(fn: KotlinFunction): { description: string; confidence: number } | undefined {
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
  const args = splitKotlinArgs(match[2] ?? "");
  const params = fn.params;
  if (args.length !== params.length || !args.every((arg, index) => arg === params[index])) return undefined;
  return { description: `it only delegates to ${callee}(...)`, confidence: fn.expressionBody ? 0.86 : 0.82 };
}

function shouldSkipWrapper(fn: KotlinFunction): boolean {
  return fn.modifiers.includes("override") || fn.annotations.some((annotation) => /@Composable\b/.test(annotation));
}
