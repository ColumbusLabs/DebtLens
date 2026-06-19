import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("CI workflow drift guards", () => {
  it("compares source pack metadata with the built runtime", () => {
    assert.match(ciWorkflow, /src\/cli\/index\.ts packs --format json/);
    assert.match(ciWorkflow, /dist\/cli\/index\.js packs --format json/);
    assert.match(ciWorkflow, /diff -u \/tmp\/debtlens-source-packs\.json \/tmp\/debtlens-dist-packs\.json/);
  });

  it("smoke scans shipped language packs through dist", () => {
    assert.match(ciWorkflow, /dist\/cli\/index\.js scan examples\/python --pack python --format json/);
    assert.match(ciWorkflow, /dist\/cli\/index\.js scan examples\/python --pack python --min-severity info --format markdown/);
    assert.match(ciWorkflow, /dist\/cli\/index\.js scan examples\/vue --pack vue --format json/);
    assert.match(ciWorkflow, /dist\/cli\/index\.js scan examples\/vue --pack vue --min-severity info --format markdown/);
    assert.match(ciWorkflow, /dist\/cli\/index\.js scan examples\/svelte --pack svelte --format json/);
    assert.match(ciWorkflow, /dist\/cli\/index\.js scan examples\/svelte --pack svelte --min-severity info --format markdown/);
    assert.match(ciWorkflow, /dist\/cli\/index\.js scan examples\/kotlin --pack kotlin --format json/);
    assert.match(ciWorkflow, /dist\/cli\/index\.js scan examples\/kotlin --pack kotlin --min-severity info --format markdown/);
    assert.match(ciWorkflow, /dist\/cli\/index\.js scan examples\/compose --pack compose --format json/);
    assert.match(ciWorkflow, /dist\/cli\/index\.js scan examples\/compose --pack compose --min-severity info --format markdown/);
  });
});
