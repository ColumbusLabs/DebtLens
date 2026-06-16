import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { barrelFileDetector } from "../../src/detectors/barrelFile.js";
import { runDetector } from "../helpers/runDetector.js";

describe("barrel-file detector", () => {
  it("flags a large re-export-only index barrel and lists sources", async () => {
    const src = `
export { A } from "./A";
export { B } from "./B";
export { C } from "./C";
export * from "./shared";
`;
    const issues = await runDetector(
      barrelFileDetector,
      { "src/features/index.ts": src },
      { thresholds: { "barrel-file.maxReExports": 4 } },
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "barrel-file");
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("./shared")));
  });

  it("does NOT flag small barrels below the threshold", async () => {
    const src = `
export { A } from "./A";
export { B } from "./B";
`;
    const issues = await runDetector(barrelFileDetector, { "src/index.ts": src });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag files that include local declarations", async () => {
    const src = `
export { A } from "./A";
export const version = "1.0.0";
export { B } from "./B";
`;
    const issues = await runDetector(
      barrelFileDetector,
      { "src/index.ts": src },
      { thresholds: { "barrel-file.maxReExports": 2 } },
    );
    assert.equal(issues.length, 0);
  });
});
