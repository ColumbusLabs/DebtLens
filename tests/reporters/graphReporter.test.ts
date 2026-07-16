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

  it("highlights cycle edges in the import graph", () => {
    const graph: ImportGraph = {
      nodes: ["a.ts", "b.ts", "c.ts"],
      edges: [
        { from: "a.ts", to: "b.ts", inCycle: true },
        { from: "b.ts", to: "c.ts", inCycle: false },
      ],
      cycles: [["a.ts", "b.ts"]],
    };
    const svg = renderImportGraphSvg(graph);
    assert.match(svg, /stroke="#e05d44"/);
    assert.match(svg, /stroke="#8c959f"/);
  });

  it("escapes graph and treemap labels", () => {
    const graph: ImportGraph = {
      nodes: ["src/<owner>&file.ts", "b.ts"],
      edges: [{ from: "src/<owner>&file.ts", to: "b.ts", inCycle: false }],
      cycles: [],
    };
    const svg = renderImportGraphSvg(graph);
    assert.match(svg, /src\/&lt;owner&gt;&amp;file\.ts/);
    assert.doesNotMatch(svg, /<owner>/);

    const treemap = renderDebtTreemapSvg([
      { id: "1", ruleId: "todo-comment", ruleName: "Todo", severity: "low", confidence: 1, message: "todo", file: "src/<bad&>/a.ts", tags: [] },
    ]);
    assert.match(treemap, /src\/&lt;bad&amp;&gt;/);
    assert.doesNotMatch(treemap, /<bad&>/);
  });
});
