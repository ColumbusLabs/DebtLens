import { Node, SyntaxKind } from "ts-morph";
import type { Node as MorphNode } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

export const featureFlagDebtDetector: Detector = {
  id: "stale-feature-flag",
  name: "Stale feature flag",
  description: "Flags feature flags that appear permanently enabled/disabled or unused.",
  defaultSeverity: "medium",
  tags: ["feature-flags", "cleanup", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const patterns = ["flag", "feature", "enable", "enabled", "toggle"];
    const issues: DebtIssue[] = [];
    const flagConstants = new Map<string, { file: string; line: number; value: boolean | undefined; name: string }>();
    const flagUses = new Set<string>();

    for (const file of context.files) {
      for (const declaration of file.sourceFile.getVariableDeclarations()) {
        const initializer = declaration.getInitializer();
        if (!initializer) continue;
        const literalValue = readBooleanLiteral(initializer);
        if (literalValue === undefined) continue;
        const name = declaration.getName();
        if (!looksLikeFlagName(name, patterns)) continue;
        const span = nodeLineSpan(declaration);
        flagConstants.set(name, { file: file.relativePath, line: span.startLine, value: literalValue, name });
      }

      for (const identifier of file.sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
        const text = identifier.getText();
        if (!flagConstants.has(text)) continue;
        const parent = identifier.getParent();
        if (Node.isVariableDeclaration(parent) && parent.getName() === text) {
          continue;
        }
        flagUses.add(text);
      }
    }

    for (const [name, info] of flagConstants.entries()) {
      if (!flagUses.has(name)) {
        issues.push(createIssue({
          detector: featureFlagDebtDetector,
          confidence: 0.84,
          file: info.file,
          location: { startLine: info.line, endLine: info.line },
          message: `Feature flag ${name} is defined but never referenced.`,
          evidence: [`Definition: ${name}`],
          suggestion: "Remove the unused flag definition or wire it into the rollout path it was meant to guard.",
        }));
        continue;
      }
      issues.push(createIssue({
        detector: featureFlagDebtDetector,
        confidence: 0.78,
        file: info.file,
        location: { startLine: info.line, endLine: info.line },
        message: `Feature flag ${name} is hardcoded to ${info.value}.`,
        evidence: [`Literal value: ${String(info.value)}`],
        suggestion: "Remove the flag and dead branch once rollout is complete, or source the value from configuration.",
      }));
    }

    return issues;
  },
};

function looksLikeFlagName(name: string, patterns: string[]): boolean {
  const lower = name.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}

function readBooleanLiteral(node: MorphNode): boolean | undefined {
  if (Node.isTrueLiteral(node)) return true;
  if (Node.isFalseLiteral(node)) return false;
  return undefined;
}
