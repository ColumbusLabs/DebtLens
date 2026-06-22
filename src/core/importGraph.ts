import { dirname, extname, join, normalize } from "node:path";
import type { SourceFileInfo } from "./types.js";

export interface ImportGraphEdge {
  from: string;
  to: string;
  inCycle: boolean;
}

export interface ImportGraph {
  nodes: string[];
  edges: ImportGraphEdge[];
  cycles: string[][];
}

export function buildImportGraphFromFiles(files: SourceFileInfo[], allowTypeOnly = true): ImportGraph {
  const adjacency = buildAdjacency(files, allowTypeOnly);
  const cycles = findCycles(adjacency);
  const cycleEdges = new Set<string>();
  for (const cycle of cycles) {
    for (let index = 0; index < cycle.length - 1; index += 1) {
      const from = cycle[index];
      const to = cycle[index + 1];
      if (from && to) cycleEdges.add(`${from}->${to}`);
    }
  }
  const edges: ImportGraphEdge[] = [];
  for (const [from, targets] of adjacency.entries()) {
    for (const to of targets) {
      edges.push({ from, to, inCycle: cycleEdges.has(`${from}->${to}`) });
    }
  }
  return {
    nodes: [...adjacency.keys()].sort((left, right) => left.localeCompare(right)),
    edges: edges.sort((left, right) => `${left.from}->${left.to}`.localeCompare(`${right.from}->${right.to}`)),
    cycles,
  };
}

function buildAdjacency(files: SourceFileInfo[], allowTypeOnly: boolean): Map<string, Set<string>> {
  const byRelative = new Map(files.map((file) => [file.relativePath, file]));
  const graph = new Map<string, Set<string>>();
  for (const file of files) graph.set(file.relativePath, new Set());

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
  for (const file of graph.keys()) visit(file, file, [file], new Set([file]));
  return cycles;
}
