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

  it("smoke scans the shipped Python pack through dist", () => {
    assert.match(ciWorkflow, /dist\/cli\/index\.js scan examples\/python --pack python --format json/);
    assert.match(ciWorkflow, /dist\/cli\/index\.js scan examples\/python --pack python --min-severity info --format markdown/);
  });
});
