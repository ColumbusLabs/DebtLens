import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { namingDriftDetector } from "../../src/detectors/namingDrift.js";
import { runDetector } from "../helpers/runDetector.js";

describe("naming-drift detector", () => {
  it("flags a file mixing many competing terms for one concept", async () => {
    // release + date + air + launch => 4 variants of the "time-of-release" group
    const src = `
const releaseDate = 1;
const airLaunch = 2;
export { releaseDate, airLaunch };
`;
    const issues = await runDetector(namingDriftDetector, { "release.ts": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "naming-drift");
    assert.match(issues[0]?.message ?? "", /release timing/);
  });

  it("does NOT flag a file with fewer variants than the threshold", async () => {
    const src = `
const releaseDate = 1;
export { releaseDate };
`;
    const issues = await runDetector(namingDriftDetector, { "release.ts": src });
    assert.equal(issues.length, 0);
  });
});
