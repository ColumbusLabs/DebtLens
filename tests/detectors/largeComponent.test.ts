import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { largeComponentDetector } from "../../src/detectors/largeComponent.js";
import { runDetector } from "../helpers/runDetector.js";

describe("large-component detector", () => {
  it("flags a component over the hook budget (via threshold override)", async () => {
    const src = `
export function Screen() {
  const a = useState(0);
  const b = useState(0);
  const c = useState(0);
  const d = useState(0);
  return <div />;
}
`;
    const issues = await runDetector(
      largeComponentDetector,
      { "Screen.tsx": src },
      { thresholds: { "large-component.maxHooks": 3 } },
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "large-component");
  });

  it("does NOT flag a small component within budget", async () => {
    const src = `
export function Screen() {
  const a = useState(0);
  return <div>{a}</div>;
}
`;
    const issues = await runDetector(
      largeComponentDetector,
      { "Screen.tsx": src },
      { thresholds: { "large-component.maxHooks": 3 } },
    );
    assert.equal(issues.length, 0);
  });

  it("does NOT flag a non-component function regardless of size", async () => {
    const src = `
export function compute() {
  const a = useState(0);
  const b = useState(0);
  const c = useState(0);
  const d = useState(0);
  return a;
}
`;
    const issues = await runDetector(
      largeComponentDetector,
      { "compute.ts": src },
      { thresholds: { "large-component.maxHooks": 3 } },
    );
    assert.equal(issues.length, 0);
  });
});
