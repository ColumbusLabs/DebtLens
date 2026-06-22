import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderDebtTreemapSvg, renderImportGraphSvg } from "../../src/reporters/graphReporter.js";
import type { ImportGraph } from "../../src/core/importGraph.js";

describe("graph reporter", () => {
  it("renders self-contained svg fragments", () => {
    const graph: ImportGraph = {
      nodes: ["a.ts", "b.ts"],
      edges: [{ from: "a.ts", to: "b.ts", inCycle: false }],
      cycles: [],
    };
    const svg = renderImportGraphSvg(graph);
    assert.match(svg, /<svg/);
    assert.doesNotMatch(svg, /https?:\/\//);
    const treemap = renderDebtTreemapSvg([
      { id: "1", ruleId: "todo-comment", ruleName: "Todo", severity: "low", confidence: 1, message: "todo", file: "src/a.ts", tags: [] },
    ]);
    assert.match(treemap, /<svg/);
  });
});
