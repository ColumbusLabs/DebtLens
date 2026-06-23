import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildImportGraphFromFiles } from "../../src/core/importGraph.js";
import { parseSourceFile } from "../../src/core/languages.js";
import { Project, ScriptTarget, ts } from "ts-morph";

describe("import graph", () => {
  it("marks cycle edges", () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { allowJs: true, target: ScriptTarget.ES2022 },
    });
    const a = parseSourceFile({
      project,
      absolutePath: "/a.ts",
      relativePath: "a.ts",
      content: `import "./b.ts";\nexport const a = 1;`,
      language: "tsjs",
    });
    const b = parseSourceFile({
      project,
      absolutePath: "/b.ts",
      relativePath: "b.ts",
      content: `import "./a.ts";\nexport const b = 1;`,
      language: "tsjs",
    });
    const graph = buildImportGraphFromFiles([a, b], true);
    assert.ok(graph.cycles.length > 0);
    assert.ok(graph.edges.some((edge) => edge.inCycle));
  });
});
