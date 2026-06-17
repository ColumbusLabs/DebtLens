import { dirname, extname, join, normalize } from "node:path";
import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";

export const importCycleDetector: Detector = {
  id: "import-cycle",
  name: "Import cycle",
  description: "Flags circular relative import graphs that make modules harder to reason about.",
  defaultSeverity: "medium",
  tags: ["architecture", "imports", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const minCycleSize = context.getThreshold("import-cycle.minCycleSize", 2);
    const allowTypeOnly = context.getThreshold("import-cycle.allowTypeOnly", 1) >= 1;
    const graph = buildImportGraph(context.files, allowTypeOnly);
    const cycles = findCycles(graph).filter((cycle) => cycleSize(cycle) >= minCycleSize);
    const issues: DebtIssue[] = [];
    const seen = new Set<string>();

    for (const cycle of cycles) {
      const key = canonicalCycleKey(cycle);
      if (seen.has(key)) continue;
      seen.add(key);
      const start = cycle[0];
      if (!start) continue;
      const size = cycleSize(cycle);
      issues.push(createIssue({
        detector: importCycleDetector,
        severity: size > 3 ? "high" : "medium",
        confidence: 0.86,
        file: start,
        location: { startLine: 1 },
        message: `Relative imports form a ${size}-file cycle.`,
        evidence: cyclePath(cycle),
        suggestion: "Break the cycle by moving shared contracts into a lower-level module or inverting one dependency.",
      }));
    }

    return issues.slice(0, 50);
  },
};

function buildImportGraph(files: SourceFileInfo[], allowTypeOnly: boolean): Map<string, Set<string>> {
  const byRelative = new Map(files.map((file) => [file.relativePath, file]));
  const graph = new Map<string, Set<string>>();
  for (const file of files) {
    graph.set(file.relativePath, new Set());
  }

  for (const file of files) {
    const edges = graph.get(file.relativePath);
    if (!edges) continue;
    for (const importDeclaration of file.sourceFile.getImportDeclarations()) {
      if (allowTypeOnly && importDeclaration.isTypeOnly()) continue;
      const specifier = importDeclaration.getModuleSpecifierValue();
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveRelativeModule(file.relativePath, specifier, byRelative);
      if (resolved) edges.add(resolved);
    }
    for (const exportDeclaration of file.sourceFile.getExportDeclarations()) {
      if (allowTypeOnly && exportDeclaration.isTypeOnly()) continue;
      const specifier = exportDeclaration.getModuleSpecifierValue();
      if (!specifier?.startsWith(".")) continue;
      const resolved = resolveRelativeModule(file.relativePath, specifier, byRelative);
      if (resolved) edges.add(resolved);
    }
  }

  return graph;
}

function resolveRelativeModule(
  fromRelativePath: string,
  specifier: string,
  files: Map<string, SourceFileInfo>,
): string | undefined {
  const base = normalize(join(dirname(fromRelativePath), specifier)).replaceAll("\\", "/");
  const candidates = extname(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.jsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
        `${base}/index.js`,
        `${base}/index.jsx`,
      ];
  return candidates.find((candidate) => files.has(candidate));
}

function findCycles(graph: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const visit = (start: string, current: string, path: string[], seen: Set<string>) => {
    for (const next of graph.get(current) ?? []) {
      if (next === start) {
        cycles.push([...path, next]);
        continue;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      visit(start, next, [...path, next], seen);
      seen.delete(next);
    }
  };

  for (const file of graph.keys()) {
    visit(file, file, [file], new Set([file]));
  }

  return cycles;
}

function canonicalCycleKey(cycleWithRepeat: string[]): string {
  const cycle = cycleWithRepeat.slice(0, -1);
  const rotations = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)].join("|"));
  return rotations.sort()[0] ?? cycle.join("|");
}

function cyclePath(cycleWithRepeat: string[]): string[] {
  return cycleWithRepeat.map((file, index) => index === 0 ? file : `imports ${file}`);
}

function cycleSize(cycleWithRepeat: string[]): number {
  return Math.max(0, cycleWithRepeat.length - 1);
}
