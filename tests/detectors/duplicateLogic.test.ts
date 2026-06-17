import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Project, ScriptTarget, ts } from "ts-morph";
import type { SourceFileInfo } from "../../src/core/types.js";
import { buildDuplicateLogicCandidatePairs, duplicateLogicDetector } from "../../src/detectors/duplicateLogic.js";
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
  it("prunes obvious fingerprint mismatches before pairwise text comparison", () => {
    const candidatePairs = buildDuplicateLogicCandidatePairs([
      {
        file: "branchy.ts",
        startLine: 1,
        fingerprint: new Map([
          ["if", 1],
          ["return", 2],
          ["binop", 1],
        ]),
      },
      {
        file: "view.tsx",
        startLine: 1,
        fingerprint: new Map([
          ["jsx", 4],
          ["call.prop", 2],
        ]),
      },
      {
        file: "branchy-copy.ts",
        startLine: 1,
        fingerprint: new Map([
          ["if", 1],
          ["return", 2],
          ["binop", 1],
        ]),
      },
    ], 0.6);

    assert.deepEqual(candidatePairs, [{ leftIndex: 0, rightIndex: 2 }]);
  });

  it("preserves old pair semantics for zero thresholds, empty fingerprints, and local snippets", () => {
    const candidates = [
      {
        file: "a.ts",
        startLine: 10,
        fingerprint: new Map([["if", 1]]),
      },
      {
        file: "a.ts",
        startLine: 12,
        fingerprint: new Map([["if", 1]]),
      },
      {
        file: "b.ts",
        startLine: 10,
        fingerprint: new Map(),
      },
      {
        file: "c.ts",
        startLine: 10,
        fingerprint: new Map(),
      },
    ];

    assert.deepEqual(buildDuplicateLogicCandidatePairs(candidates, 0), [
      { leftIndex: 0, rightIndex: 2 },
      { leftIndex: 0, rightIndex: 3 },
      { leftIndex: 1, rightIndex: 2 },
      { leftIndex: 1, rightIndex: 3 },
      { leftIndex: 2, rightIndex: 3 },
    ]);
    assert.deepEqual(buildDuplicateLogicCandidatePairs(candidates, 1), [
      { leftIndex: 2, rightIndex: 3 },
    ]);
  });

  it("flags two structurally identical functions across files", async () => {
    const issues = await runDetector(duplicateLogicDetector, {
      "movie.ts": movie,
      "game.ts": game,
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "duplicate-logic");
    assert.ok((issues[0]?.confidence ?? 0) >= 0.86);
  });

  it("still reports matching duplicates when unrelated snippets are pruned", async () => {
    const unrelatedWorker = `
export async function loadAccountSnapshot(client, accountId) {
  const response = await client.fetchAccount(accountId);
  try {
    const records = await response.json();
    return records.map((record) => ({
      id: record.id,
      balance: Number(record.balance || 0),
    }));
  } catch (error) {
    return [];
  }
}
`;
    const unrelatedView = `
export function ReleaseCard(props) {
  const rows = props.items.map((item) => (
    <li key={item.id}>
      <span>{item.title}</span>
      <strong>{item.status}</strong>
    </li>
  ));
  return <section><h2>{props.heading}</h2><ul>{rows}</ul></section>;
}
`;
    const issues = await runDetector(duplicateLogicDetector, {
      "movie.ts": movie,
      "worker.ts": unrelatedWorker,
      "game.ts": game,
      "view.tsx": unrelatedView,
    });

    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /normalizeMovieRelease|normalizeGameRelease/);
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
