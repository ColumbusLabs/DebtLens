import { Node, SyntaxKind } from "ts-morph";
import type { Node as MorphNode } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

interface LiteralOccurrence {
  file: string;
  line: number;
  node: MorphNode;
}

interface LiteralBucket {
  value: string;
  kind: "string" | "number";
  occurrences: LiteralOccurrence[];
  files: Set<string>;
}

const COMMON_STRING_LITERALS = new Set([
  "",
  "id",
  "key",
  "name",
  "type",
  "value",
  "label",
  "title",
  "children",
  "className",
  "default",
  "test",
  "development",
  "production",
  "loading",
  "error",
  "success",
]);

const COMMON_NUMBER_LITERALS = new Set(["0", "1", "2", "-1"]);

export const duplicatedLiteralDetector: Detector = {
  id: "duplicated-literal",
  name: "Duplicated literal",
  description: "Flags repeated string and number literals that spread domain constants across files.",
  defaultSeverity: "low",
  tags: ["duplication", "constants", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const minLength = context.getThreshold("duplicated-literal.minLength", 6);
    const minCount = context.getThreshold("duplicated-literal.minCount", 3);
    const buckets = new Map<string, LiteralBucket>();

    for (const file of context.files) {
      for (const node of file.sourceFile.getDescendants()) {
        const literal = readLiteral(node, minLength);
        if (!literal || isIgnoredLiteralContext(node)) continue;

        const key = `${literal.kind}:${literal.value}`;
        const span = nodeLineSpan(node);
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = {
            value: literal.value,
            kind: literal.kind,
            occurrences: [],
            files: new Set(),
          };
          buckets.set(key, bucket);
        }

        bucket.occurrences.push({ file: file.relativePath, line: span.startLine, node });
        bucket.files.add(file.relativePath);
      }
    }

    const issues: DebtIssue[] = [];
    for (const bucket of [...buckets.values()].sort(compareBuckets)) {
      if (bucket.occurrences.length < minCount || bucket.files.size < 2) continue;

      const first = bucket.occurrences[0];
      if (!first) continue;
      const span = nodeLineSpan(first.node);
      const displayValue = bucket.kind === "string" ? JSON.stringify(bucket.value) : bucket.value;

      issues.push(createIssue({
        detector: duplicatedLiteralDetector,
        severity: bucket.occurrences.length >= minCount * 2 ? "medium" : "low",
        confidence: 0.74,
        file: first.file,
        location: { startLine: span.startLine, endLine: span.endLine },
        message: `${displayValue} is repeated ${bucket.occurrences.length} times across ${bucket.files.size} files.`,
        evidence: bucket.occurrences
          .slice(0, 8)
          .map((occurrence) => `${occurrence.file}:${occurrence.line}`),
        suggestion: "Promote repeated domain values to a named constant, enum, fixture, or shared test helper when the occurrences represent the same concept.",
      }));

      if (issues.length >= 50) return issues;
    }

    return issues;
  },
};

function readLiteral(node: MorphNode, minLength: number): { kind: "string" | "number"; value: string } | undefined {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    const text = node.getText();
    const value = text.length >= 2 ? text.slice(1, -1) : text;
    if (value.length < minLength || COMMON_STRING_LITERALS.has(value)) return undefined;
    return { kind: "string", value };
  }

  if (Node.isNumericLiteral(node)) {
    const value = node.getText().replace(/_/g, "");
    if (value.length < minLength || COMMON_NUMBER_LITERALS.has(value)) return undefined;
    return { kind: "number", value };
  }

  return undefined;
}

function isIgnoredLiteralContext(node: MorphNode): boolean {
  return hasAncestorKind(node, SyntaxKind.ImportDeclaration)
    || hasAncestorKind(node, SyntaxKind.ExportDeclaration)
    || hasAncestorKind(node, SyntaxKind.LiteralType);
}

function hasAncestorKind(node: MorphNode, kind: SyntaxKind): boolean {
  let current = node.getParent();
  while (current) {
    if (current.getKind() === kind) return true;
    current = current.getParent();
  }
  return false;
}

function compareBuckets(a: LiteralBucket, b: LiteralBucket): number {
  return b.occurrences.length - a.occurrences.length
    || b.files.size - a.files.size
    || a.kind.localeCompare(b.kind)
    || a.value.localeCompare(b.value);
}
