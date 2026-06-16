import path from "node:path";
import { SyntaxKind } from "ts-morph";
import type { Node as MorphNode } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../core/types.js";
import { collectFunctionLikes, getFunctionBody } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

interface ImportUse {
  importer: string;
  names: Set<string>;
}

export const storyOnlyComponentDetector: Detector = {
  id: "story-only-component",
  name: "Story-only component",
  description: "Flags exported React components that are consumed only by Storybook stories.",
  defaultSeverity: "low",
  tags: ["react", "storybook", "cleanup"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const importsByTarget = collectRelativeImports(context.files);

    for (const file of context.files) {
      if (isStoryFile(file.relativePath)) continue;

      const exportedDeclarations = file.sourceFile.getExportedDeclarations();
      for (const fn of collectFunctionLikes(file)) {
        if (fn.classification !== "component") continue;

        const exportNames = getExportNames(exportedDeclarations, fn.name, fn.declaration);
        if (exportNames.length === 0) continue;

        const importUses = getImportUses(importsByTarget.get(file.relativePath) ?? [], exportNames);
        if (importUses.length === 0) continue;
        if (importUses.some((use) => !isStoryFile(use.importer))) continue;

        const body = getFunctionBody(fn.node) ?? fn.node;
        const span = nodeLineSpan(body);
        issues.push(createIssue({
          detector: storyOnlyComponentDetector,
          severity: "low",
          confidence: 0.7,
          file: file.relativePath,
          location: { startLine: span.startLine, endLine: span.endLine },
          message: `${fn.name} is exported, but its current consumers are only Storybook story files.`,
          evidence: importUses.map((use) => `${use.importer}: imports ${formatImportedNames(use.names, exportNames)}`),
          suggestion: "Keep it if the story is documenting a planned app boundary. Otherwise move it into the story file or connect it to production code before it grows a public API.",
        }));
      }
    }

    return issues;
  },
};

function collectRelativeImports(files: SourceFileInfo[]): Map<string, ImportUse[]> {
  const knownFiles = new Set(files.map((file) => file.relativePath));
  const importsByTarget = new Map<string, ImportUse[]>();
  const reExportsByBarrel = new Map<string, Array<{ target: string; names: Set<string> }>>();

  for (const file of files) {
    for (const declaration of file.sourceFile.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (!specifier.startsWith(".")) continue;

      const target = resolveRelativeImport(file.relativePath, specifier, knownFiles);
      if (!target) continue;

      const names = new Set<string>();
      if (declaration.getDefaultImport()) names.add("default");
      if (declaration.getNamespaceImport()) names.add("*");
      for (const namedImport of declaration.getNamedImports()) {
        names.add(namedImport.getAliasNode()?.getText() ? namedImport.getNameNode().getText() : namedImport.getName());
      }
      if (names.size === 0) continue;

      const uses = importsByTarget.get(target) ?? [];
      uses.push({ importer: file.relativePath, names });
      importsByTarget.set(target, uses);
    }

    for (const declaration of file.sourceFile.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (!specifier?.startsWith(".")) continue;
      const target = resolveRelativeImport(file.relativePath, specifier, knownFiles);
      if (!target) continue;
      const names = new Set<string>();
      for (const namedExport of declaration.getNamedExports()) {
        names.add(namedExport.getAliasNode()?.getText() ?? namedExport.getName());
      }
      if (names.size === 0) names.add("*");

      const reExports = reExportsByBarrel.get(file.relativePath) ?? [];
      reExports.push({ target, names });
      reExportsByBarrel.set(file.relativePath, reExports);
    }
  }

  for (const [barrel, reExports] of reExportsByBarrel) {
    const barrelUses = importsByTarget.get(barrel) ?? [];
    if (barrelUses.length === 0) continue;

    for (const reExport of reExports) {
      for (const use of barrelUses) {
        const forwardedNames = intersectImportNames(use.names, reExport.names);
        if (forwardedNames.size === 0) continue;
        const targetUses = importsByTarget.get(reExport.target) ?? [];
        targetUses.push({ importer: use.importer, names: forwardedNames });
        importsByTarget.set(reExport.target, targetUses);
      }
    }
  }

  return importsByTarget;
}

function intersectImportNames(importedNames: Set<string>, exportedNames: Set<string>): Set<string> {
  if (importedNames.has("*") || exportedNames.has("*")) return new Set(importedNames);
  const names = new Set<string>();
  for (const name of importedNames) {
    if (exportedNames.has(name)) names.add(name);
  }
  return names;
}

function resolveRelativeImport(importerPath: string, specifier: string, knownFiles: Set<string>): string | undefined {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), specifier));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.posix.join(base, "index.ts"),
    path.posix.join(base, "index.tsx"),
    path.posix.join(base, "index.js"),
    path.posix.join(base, "index.jsx"),
  ];
  return candidates.find((candidate) => knownFiles.has(candidate));
}

function getExportNames(
  exportedDeclarations: ReadonlyMap<string, readonly MorphNode[]>,
  componentName: string,
  declaration: MorphNode,
): string[] {
  const names: string[] = [];

  for (const [exportName, declarations] of exportedDeclarations) {
    if (exportName === componentName) {
      names.push(exportName);
      continue;
    }

    if (declarations.some((exported) => isSameDeclaration(exported, declaration))) {
      names.push(exportName);
    }
  }

  return Array.from(new Set(names));
}

function isSameDeclaration(exported: MorphNode, declaration: MorphNode): boolean {
  return exported === declaration
    || exported.getStart() === declaration.getStart()
    || exported.getAncestors().some((ancestor) => ancestor === declaration)
    || declaration.getAncestors().some((ancestor) => ancestor === exported);
}

function getImportUses(uses: ImportUse[], exportNames: string[]): ImportUse[] {
  return uses.filter((use) =>
    use.names.has("*")
    || exportNames.some((exportName) => use.names.has(exportName)),
  );
}

function formatImportedNames(importedNames: Set<string>, exportNames: string[]): string {
  if (importedNames.has("*")) return "namespace";
  return exportNames.filter((exportName) => importedNames.has(exportName)).join(", ");
}

function isStoryFile(relativePath: string): boolean {
  return /\.stories\.[cm]?[jt]sx?$/.test(relativePath);
}
