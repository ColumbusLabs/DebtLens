import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Project, ScriptTarget } from "ts-morph";
import { structuralFingerprint } from "../../src/utils/ast.js";
import { cosineSimilarity } from "../../src/utils/similarity.js";

function fingerprintOf(code: string): Map<string, number> {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { target: ScriptTarget.ES2022 },
  });
  const sf = project.createSourceFile("f.ts", code, { overwrite: true });
  const fn = sf.getFunctions()[0];
  assert.ok(fn, "expected a function declaration");
  const body = fn.getBody();
  assert.ok(body, "expected a function body");
  return structuralFingerprint(body);
}

describe("structuralFingerprint + cosineSimilarity", () => {
  it("is near-identical for same-shape functions with different names", () => {
    const a = fingerprintOf(`
function normalizeMovie(input) {
  const title = input.title.trim();
  if (!title) { return null; }
  return { title };
}
`);
    const b = fingerprintOf(`
function normalizeGame(payload) {
  const name = payload.name.trim();
  if (!name) { return null; }
  return { name };
}
`);
    assert.ok(cosineSimilarity(a, b) > 0.99, "expected near-1 structural similarity");
  });

  it("is low for structurally different functions", () => {
    const branchy = fingerprintOf(`
function classify(values) {
  for (const v of values) {
    if (v > 0) { console.log(v); }
    else if (v < 0) { console.warn(v); }
    else { console.error(v); }
  }
  return values.length;
}
`);
    const flat = fingerprintOf(`
function add(x) {
  return x + 1;
}
`);
    assert.ok(cosineSimilarity(branchy, flat) < 0.6, "expected low structural similarity");
  });

  it("treats two empty fingerprints as identical", () => {
    assert.equal(cosineSimilarity(new Map(), new Map()), 1);
  });
});
