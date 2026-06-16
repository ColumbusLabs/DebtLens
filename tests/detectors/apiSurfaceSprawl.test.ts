import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiSurfaceSprawlDetector } from "../../src/detectors/apiSurfaceSprawl.js";
import { runDetector } from "../helpers/runDetector.js";

describe("api-surface-sprawl detector", () => {
  it("flags files exporting too many public symbols", async () => {
    const src = `
export const a = 1;
export const b = 2;
export function c() {}
export class D {}
export interface E { id: string }
`;
    const issues = await runDetector(
      apiSurfaceSprawlDetector,
      { "src/api.ts": src },
      { thresholds: { "api-surface-sprawl.maxExports": 5 } },
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "api-surface-sprawl");
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("a, b, c, D, E")));
  });

  it("counts named barrel re-exports as public symbols", async () => {
    const src = `
export { A, B } from "./a";
export { C, D } from "./b";
`;
    const issues = await runDetector(
      apiSurfaceSprawlDetector,
      { "src/index.ts": src },
      { thresholds: { "api-surface-sprawl.maxExports": 4 } },
    );
    assert.equal(issues.length, 1);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("Re-export sources: ./a, ./b")));
  });

  it("counts star re-exports as one unresolved public source each", async () => {
    const src = `
export * from "./a";
export * from "./b";
export * from "./c";
`;
    const issues = await runDetector(
      apiSurfaceSprawlDetector,
      { "src/index.ts": src },
      { thresholds: { "api-surface-sprawl.maxExports": 3 } },
    );
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /3 public symbols/);
  });

  it("does NOT flag files below the export threshold", async () => {
    const src = `
export const a = 1;
export function b() {}
`;
    const issues = await runDetector(
      apiSurfaceSprawlDetector,
      { "src/api.ts": src },
      { thresholds: { "api-surface-sprawl.maxExports": 4 } },
    );
    assert.equal(issues.length, 0);
  });
});
