import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectComplexityDetector } from "../../src/detectors/effectComplexity.js";
import { runDetector } from "../helpers/runDetector.js";

describe("effect-complexity detector", () => {
  it("flags a useEffect with too many dependencies", async () => {
    const src = `
export function Widget() {
  useEffect(() => {
    load();
  }, [a, b, c, d, e, f, g, h]);
  return null;
}
`;
    const issues = await runDetector(effectComplexityDetector, { "Widget.tsx": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "effect-complexity");
    assert.match(issues[0]?.message ?? "", /8 dependencies/);
  });

  it("does NOT flag a small, focused useEffect", async () => {
    const src = `
export function Widget() {
  useEffect(() => {
    subscribe();
  }, [id]);
  return null;
}
`;
    const issues = await runDetector(effectComplexityDetector, { "Widget.tsx": src });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag a non-useEffect call with many array args", async () => {
    const src = `
export function compute() {
  doWork(() => run(), [a, b, c, d, e, f, g, h]);
  return 1;
}
`;
    const issues = await runDetector(effectComplexityDetector, { "compute.ts": src });
    assert.equal(issues.length, 0);
  });
});
