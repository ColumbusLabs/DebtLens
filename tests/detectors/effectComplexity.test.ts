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
    assert.equal(issues[0]?.severity, "medium");
    assert.equal(issues[0]?.confidence, 0.8);
  });

  it("down-ranks a single delegated custom hook effect", async () => {
    const src = `
export function Widget() {
  useEffect(() => {
    useData(a, b, c, d, e, f, g, h, i, j, k, l);
  }, [a, b, c, d, e, f, g, h, i, j, k, l]);
  return null;
}
`;
    const issues = await runDetector(effectComplexityDetector, { "Widget.tsx": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "effect-complexity");
    assert.equal(issues[0]?.severity, "low");
    assert.ok((issues[0]?.confidence ?? 1) < 0.8);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("useData")));
  });

  it("flags a useLayoutEffect with the same thresholds", async () => {
    const src = `
export function Widget() {
  useLayoutEffect(() => {
    measure();
    if (ready) {
      syncLayout();
    }
    if (width > 100) {
      resize();
    }
    if (height > 100) {
      resizeAgain();
    }
    if (mode === "full") {
      expand();
    }
  }, [ready]);
  return null;
}
`;
    const issues = await runDetector(effectComplexityDetector, { "Widget.tsx": src });
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /useLayoutEffect/);
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

  it("does NOT flag a small, focused useInsertionEffect", async () => {
    const src = `
export function Widget() {
  useInsertionEffect(() => {
    insertCriticalCss();
  }, [theme]);
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
