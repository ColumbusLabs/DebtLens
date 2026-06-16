import { Node, SyntaxKind } from "ts-morph";
import type { Node as MorphNode } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

interface ExportCount {
  name: string;
  source?: string;
}

export const apiSurfaceSprawlDetector: Detector = {
  id: "api-surface-sprawl",
  name: "API surface sprawl",
  description: "Flags files that export enough public symbols to become hard-to-review API surfaces.",
  defaultSeverity: "medium",
  tags: ["api-design", "module-boundaries", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxExports = context.getThreshold("api-surface-sprawl.maxExports", 12);

    for (const file of context.files) {
      const exports = collectPublicExports(file.sourceFile);
      if (exports.length < maxExports) continue;

      const reExportSources = new Set(exports.map((item) => item.source).filter((source): source is string => Boolean(source)));
      const span = nodeLineSpan(file.sourceFile);
      issues.push(createIssue({
        detector: apiSurfaceSprawlDetector,
        severity: exports.length >= maxExports * 1.5 ? "high" : "medium",
        confidence: 0.78,
        file: file.relativePath,
        location: { startLine: span.startLine, endLine: span.endLine },
        message: `${file.relativePath} exports ${exports.length} public symbols.`,
        evidence: [
          `Exports: ${exports.length} / ${maxExports}`,
          `Symbols: ${exports.slice(0, 12).map((item) => item.name).join(", ")}`,
          ...(reExportSources.size > 0 ? [`Re-export sources: ${[...reExportSources].slice(0, 8).join(", ")}`] : []),
        ],
        suggestion: "Split implementation details from the public entrypoint, or group related exports behind focused modules with stable ownership.",
      }));
    }

    return issues;
  },
};

function collectPublicExports(sourceFile: MorphNode): ExportCount[] {
  const exports: ExportCount[] = [];

  for (const statement of sourceFile.asKindOrThrow(SyntaxKind.SourceFile).getStatements()) {
    if (Node.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      exports.push({ name: statement.getName() ?? "default" });
    } else if (Node.isClassDeclaration(statement) && hasExportModifier(statement)) {
      exports.push({ name: statement.getName() ?? "default" });
    } else if (Node.isInterfaceDeclaration(statement) && hasExportModifier(statement)) {
      exports.push({ name: statement.getName() });
    } else if (Node.isTypeAliasDeclaration(statement) && hasExportModifier(statement)) {
      exports.push({ name: statement.getName() });
    } else if (Node.isEnumDeclaration(statement) && hasExportModifier(statement)) {
      exports.push({ name: statement.getName() });
    } else if (Node.isModuleDeclaration(statement) && hasExportModifier(statement)) {
      exports.push({ name: statement.getName() });
    } else if (Node.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.getDeclarations()) {
        exports.push({ name: declaration.getName() });
      }
    } else if (Node.isExportAssignment(statement)) {
      exports.push({ name: "default" });
    } else if (Node.isExportDeclaration(statement)) {
      const source = statement.getModuleSpecifierValue();
      const namedExports = statement.getNamedExports();
      if (namedExports.length > 0) {
        for (const specifier of namedExports) {
          exports.push({ name: specifier.getAliasNode()?.getText() ?? specifier.getName(), source });
        }
      } else if (source) {
        exports.push({ name: `* from ${source}`, source });
      }
    }
  }

  return exports;
}

function hasExportModifier(node: { getModifiers: () => Array<{ getKind: () => SyntaxKind }> }): boolean {
  return node.getModifiers().some((modifier) =>
    modifier.getKind() === SyntaxKind.ExportKeyword || modifier.getKind() === SyntaxKind.DefaultKeyword,
  );
}
