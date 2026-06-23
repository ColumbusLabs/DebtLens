import { Node, SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../core/types.js";
import { collectFunctionLikes } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { countLines } from "../utils/lines.js";

interface ModuleMetrics {
  totalLines: number;
  exportCount: number;
  topLevelDeclCount: number;
  concernCategories: number;
}

export const godFileDetector: Detector = {
  id: "god-file",
  name: "God file",
  description: "Flags kitchen-sink modules that exceed multiple size, export, and responsibility-spread thresholds together.",
  defaultSeverity: "medium",
  tags: ["module-boundaries", "maintainability", "architecture"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxLines = context.getThreshold("god-file.maxLines", 400);
    const maxExports = context.getThreshold("god-file.maxExports", 10);
    const maxTopLevelDecls = context.getThreshold("god-file.maxTopLevelDecls", 12);
    const minAxes = context.getThreshold("god-file.minAxes", 3);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      const metrics = collectModuleMetrics(file);
      const axes = countExceededAxes(metrics, maxLines, maxExports, maxTopLevelDecls);
      if (axes.length < minAxes) continue;

      const confidence = Math.min(0.95, 0.58 + axes.length * 0.1 + (axes.length >= minAxes + 1 ? 0.08 : 0));
      issues.push(createIssue({
        detector: godFileDetector,
        severity: axes.length >= minAxes + 1 ? "high" : "medium",
        confidence,
        file: file.relativePath,
        location: { startLine: 1, endLine: metrics.totalLines },
        message: `${file.relativePath} looks like a kitchen-sink module with ${axes.length} independent sprawl signals.`,
        evidence: [
          `Lines: ${metrics.totalLines} / ${maxLines}`,
          `Exports: ${metrics.exportCount} / ${maxExports}`,
          `Top-level declarations: ${metrics.topLevelDeclCount} / ${maxTopLevelDecls}`,
          `Concern categories: ${metrics.concernCategories}`,
          `Exceeded axes: ${axes.join(", ")}`,
        ],
        suggestion: "Split the module by responsibility, extract cohesive submodules, and keep a narrow public entrypoint.",
      }));
    }

    return issues;
  },
};

function collectModuleMetrics(file: SourceFileInfo): ModuleMetrics {
  const fileNode = file.sourceFile;
  const exportCount = countPublicExports(fileNode);
  const topLevelDeclCount = countTopLevelDeclarations(fileNode);
  const concernCategories = countConcernCategories(fileNode, collectFunctionLikes(file));
  return {
    totalLines: countLines(file.content),
    exportCount,
    topLevelDeclCount,
    concernCategories,
  };
}

function countExceededAxes(
  metrics: ModuleMetrics,
  maxLines: number,
  maxExports: number,
  maxTopLevelDecls: number,
): string[] {
  const axes: string[] = [];
  if (metrics.totalLines >= maxLines) axes.push("lines");
  if (metrics.exportCount >= maxExports) axes.push("exports");
  if (metrics.topLevelDeclCount >= maxTopLevelDecls) axes.push("top-level declarations");
  if (metrics.concernCategories >= 3) axes.push("mixed concerns");
  return axes;
}

function countPublicExports(sourceFile: SourceFile): number {
  let count = 0;
  for (const statement of sourceFile.getStatements()) {
    if (hasExportModifier(statement)) count += 1;
    if (Node.isExportDeclaration(statement)) {
      const named = statement.getNamedExports();
      count += named.length > 0 ? named.length : 1;
    }
  }
  return count;
}

function hasExportModifier(node: unknown): boolean {
  if (!node || typeof node !== "object" || !("getModifiers" in node)) return false;
  const modifiers = (node as { getModifiers: () => Array<{ getKind: () => SyntaxKind }> }).getModifiers();
  return modifiers.some((modifier) =>
    modifier.getKind() === SyntaxKind.ExportKeyword || modifier.getKind() === SyntaxKind.DefaultKeyword,
  );
}

function countTopLevelDeclarations(sourceFile: SourceFile): number {
  let count = 0;
  for (const statement of sourceFile.getStatements()) {
    if (Node.isFunctionDeclaration(statement) || Node.isClassDeclaration(statement) || Node.isInterfaceDeclaration(statement)) {
      count += 1;
    } else if (Node.isVariableStatement(statement)) {
      count += statement.getDeclarations().length;
    }
  }
  return count;
}

function countConcernCategories(sourceFile: SourceFile, functions: ReturnType<typeof collectFunctionLikes>): number {
  const categories = new Set<string>();
  for (const importDecl of sourceFile.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue() ?? "";
    categories.add(categorizeImport(specifier));
  }
  for (const fn of functions) {
    categories.add(categorizeFunctionName(fn.name));
  }
  categories.delete("generic");
  return categories.size;
}

function categorizeImport(specifier: string): string {
  const lower = specifier.toLowerCase();
  if (lower.includes("react") || lower.includes("vue") || lower.includes("svelte")) return "ui";
  if (lower.includes("fs") || lower.includes("path") || lower.includes("http") || lower.includes("express")) return "io";
  if (lower.includes("test") || lower.includes("vitest") || lower.includes("jest")) return "test";
  if (lower.startsWith(".") || lower.startsWith("@/")) return "local";
  return "generic";
}

function categorizeFunctionName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("render") || lower.startsWith("use") || lower.endsWith("component")) return "ui";
  if (lower.includes("fetch") || lower.includes("load") || lower.includes("save") || lower.includes("write")) return "io";
  if (lower.includes("validate") || lower.includes("compute") || lower.includes("build")) return "domain";
  return "generic";
}
