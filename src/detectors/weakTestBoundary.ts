import { Node, SyntaxKind } from "ts-morph";
import type { Node as MorphNode } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

export const weakTestBoundaryDetector: Detector = {
  id: "weak-test-boundary",
  name: "Weak test boundary",
  description: "Flags production files that import from test-only modules.",
  defaultSeverity: "medium",
  tags: ["tests", "module-boundaries", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const allowTypeOnly = context.getThreshold("weak-test-boundary.allowTypeOnly", 0) >= 1;

    for (const file of context.files) {
      if (isTestOnlyPath(file.relativePath)) continue;

      for (const importDeclaration of file.sourceFile.getImportDeclarations()) {
        if (allowTypeOnly && importDeclaration.isTypeOnly()) continue;
        const specifier = importDeclaration.getModuleSpecifierValue();
        if (!isTestOnlyPath(specifier)) continue;
        issues.push(createBoundaryIssue(file.relativePath, importDeclaration, specifier));
      }

      for (const exportDeclaration of file.sourceFile.getExportDeclarations()) {
        if (allowTypeOnly && exportDeclaration.isTypeOnly()) continue;
        const specifier = exportDeclaration.getModuleSpecifierValue();
        if (!specifier || !isTestOnlyPath(specifier)) continue;
        issues.push(createBoundaryIssue(file.relativePath, exportDeclaration, specifier));
      }

      for (const call of file.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const specifier = readRequireOrDynamicImportSpecifier(call);
        if (!specifier || !isTestOnlyPath(specifier)) continue;
        issues.push(createBoundaryIssue(file.relativePath, call, specifier));
      }
    }

    return issues;
  },
};

function createBoundaryIssue(file: string, node: MorphNode, specifier: string): DebtIssue {
  const span = nodeLineSpan(node);
  return createIssue({
    detector: weakTestBoundaryDetector,
    severity: "medium",
    confidence: 0.86,
    file,
    location: { startLine: span.startLine, endLine: span.endLine },
    message: `${file} imports from test-only module ${specifier}.`,
    evidence: [`Import source: ${specifier}`],
    suggestion: "Move reusable helpers into a production-safe support module, or keep test fixtures behind test-only callers.",
  });
}

function readRequireOrDynamicImportSpecifier(call: MorphNode): string | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const expression = call.getExpression();
  const isRequire = Node.isIdentifier(expression) && expression.getText() === "require";
  const isDynamicImport = expression.getKind() === SyntaxKind.ImportKeyword;
  if (!isRequire && !isDynamicImport) return undefined;

  const [firstArg] = call.getArguments();
  return firstArg && Node.isStringLiteral(firstArg) ? firstArg.getLiteralText() : undefined;
}

function isTestOnlyPath(value: string): boolean {
  return /(^|[\\/])(?:__tests__|__mocks__)(?:[\\/]|$)/.test(value)
    || /\.(?:test|spec)(?:\.[cm]?[jt]sx?)?$/.test(value);
}
