import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { buildImportGraphFromFiles } from "../core/importGraph.js";
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
    const graph = buildImportGraphFromFiles(context.files, allowTypeOnly);
    const issues: DebtIssue[] = [];
    const seen = new Set<string>();

    for (const cycle of graph.cycles.filter((candidate) => cycleSize(candidate) >= minCycleSize)) {
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
