import { Node } from "ts-morph";
import type { ExportDeclaration, Statement } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

export const barrelFileDetector: Detector = {
  id: "barrel-file",
  name: "Barrel file",
  description: "Flags large re-export-only index/barrel files that obscure dependency graphs.",
  defaultSeverity: "low",
  tags: ["imports", "module-boundaries", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxReExports = context.getThreshold("barrel-file.maxReExports", 6);

    for (const file of context.files) {
      if (!isIndexOrBarrel(file.relativePath)) continue;

      const statements = file.sourceFile.getStatements();
      if (statements.length === 0) continue;
      const reExports = statements.filter(isModuleReExport);

      if (reExports.length !== statements.length || reExports.length < maxReExports) continue;

      const sourceCounts = new Map<string, number>();
      for (const reExport of reExports) {
        const source = reExport.getModuleSpecifierValue() ?? "<unknown>";
        sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
      }

      const span = nodeLineSpan(file.sourceFile);
      issues.push(createIssue({
        detector: barrelFileDetector,
        severity: reExports.length >= maxReExports * 2 ? "medium" : "low",
        confidence: 0.8,
        file: file.relativePath,
        location: { startLine: span.startLine, endLine: span.endLine },
        message: `${file.relativePath} is a re-export-only barrel with ${reExports.length} exports.`,
        evidence: [...sourceCounts.entries()]
          .slice(0, 8)
          .map(([source, count]) => `${source}: ${count} re-export${count === 1 ? "" : "s"}`),
        suggestion: "Keep only stable public entrypoints in barrels. Import implementation modules directly when the barrel is just hiding local graph shape.",
      }));
    }

    return issues;
  },
};

function isIndexOrBarrel(relativePath: string): boolean {
  const basename = relativePath.split(/[\\/]/).pop() ?? relativePath;
  return /^(?:index|barrel)\.[cm]?[jt]sx?$/.test(basename);
}

function isModuleReExport(statement: Statement): statement is ExportDeclaration {
  return Node.isExportDeclaration(statement) && statement.getModuleSpecifierValue() !== undefined;
}
