import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { featureFlagDebtDetector } from "../../src/detectors/featureFlagDebt.js";
import { runDetector } from "../helpers/runDetector.js";

describe("stale-feature-flag detector", () => {
  it("flags hardcoded boolean feature flags", async () => {
    const src = `
const enableNewCheckout = true;
export function render() {
  return enableNewCheckout ? "new" : "old";
}
`;
    const issues = await runDetector(featureFlagDebtDetector, { "flags.ts": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "stale-feature-flag");
  });

  it("flags unused boolean feature flags", async () => {
    const src = `
const enableBetaFeature = true;
export const version = 1;
`;
    const issues = await runDetector(featureFlagDebtDetector, { "flags.ts": src });
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /never referenced/);
  });

  it("tracks same-named flags per file", async () => {
    const issues = await runDetector(featureFlagDebtDetector, {
      "one.ts": "const enableCheckout = true;\nexport const one = enableCheckout;\n",
      "two.ts": "const enableCheckout = true;\nexport const two = enableCheckout;\n",
    });

    assert.equal(issues.length, 2);
    assert.deepEqual(issues.map((issue) => issue.file).sort(), ["one.ts", "two.ts"]);
  });

  it("ignores local boolean helpers that only look like flags", async () => {
    const src = `
export function render(enabled) {
  const enableButton = true;
  return enabled && enableButton;
}
`;
    const issues = await runDetector(featureFlagDebtDetector, { "local.ts": src });
    assert.equal(issues.length, 0);
  });
});
