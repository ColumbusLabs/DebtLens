import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Project, ScriptTarget, ts } from "ts-morph";
import type { SourceFileInfo } from "../../src/core/types.js";
import { duplicateLogicDetector } from "../../src/detectors/duplicateLogic.js";
import { runDetector } from "../helpers/runDetector.js";

const movie = `
export function normalizeMovieRelease(input) {
  const title = input.title.trim();
  const year = input.year || 0;
  const tags = input.tags.filter(Boolean);
  if (!title) {
    return null;
  }
  const slug = title.toLowerCase();
  return { title, year, tags, slug };
}
`;

// Same structure, different identifiers/strings — should normalize to a match.
const game = `
export function normalizeGameRelease(payload) {
  const name = payload.name.trim();
  const released = payload.released || 0;
  const labels = payload.labels.filter(Boolean);
  if (!name) {
    return null;
  }
  const key = name.toLowerCase();
  return { name, released, labels, key };
}
`;

describe("duplicate-logic detector", () => {
  it("flags two structurally identical functions across files", async () => {
    const issues = await runDetector(duplicateLogicDetector, {
      "movie.ts": movie,
      "game.ts": game,
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "duplicate-logic");
    assert.ok((issues[0]?.confidence ?? 0) >= 0.86);
  });

  it("does NOT flag two structurally different functions", async () => {
    const other = `
export function sumAndLog(values) {
  let total = 0;
  for (const value of values) {
    total = total + value;
  }
  console.log(total);
  console.log(values.length);
  return total;
}
`;
    const issues = await runDetector(duplicateLogicDetector, {
      "movie.ts": movie,
      "other.ts": other,
    });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag short functions below the minimum line count", async () => {
    const tinyA = `export function a(x) { return x + 1; }`;
    const tinyB = `export function b(y) { return y + 1; }`;
    const issues = await runDetector(duplicateLogicDetector, {
      "a.ts": tinyA,
      "b.ts": tinyB,
    });
    assert.equal(issues.length, 0);
  });

  it("warns once when eligible snippets exceed the maxSnippets cap", async () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        jsx: ts.JsxEmit.ReactJSX,
        target: ScriptTarget.ES2022,
        skipLibCheck: true,
      },
    });
    const sourceFiles: SourceFileInfo[] = [];

    for (let index = 0; index < 4; index += 1) {
      const relativePath = `file${index}.ts`;
      const content = `
export function normalize${index}(input) {
  const title = input.title.trim();
  const year = input.year || 0;
  const tags = input.tags.filter(Boolean);
  if (!title) {
    return null;
  }
  const slug = title.toLowerCase();
  return { title, year, tags, slug };
}
`;
      const sourceFile = project.createSourceFile(relativePath, content, { overwrite: true });
      sourceFiles.push({
        absolutePath: `/${relativePath}`,
        relativePath,
        content,
        sourceFile,
      });
    }

    const warnings: string[] = [];
    await duplicateLogicDetector.detect({
      project,
      files: sourceFiles,
      options: {
        cwd: "/",
        target: ".",
        include: [],
        exclude: [],
        minSeverity: "info",
        thresholds: { "duplicate-logic.maxSnippets": 2 },
      },
      getThreshold: (key, fallback) => key === "duplicate-logic.maxSnippets" ? 2 : fallback,
      addWarning: (warning) => warnings.push(warning),
    });

    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /inspected 2 of 4 eligible snippets/);
  });
});
