import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { longParameterListDetector } from "../../src/detectors/longParameterList.js";
import { runDetector } from "../helpers/runDetector.js";

describe("long-parameter-list detector", () => {
  it("flags functions with too many parameters", async () => {
    const src = `
export function build(a: string, b: string, c: string, d: string, e: string, f: string) {
  return a + b + c + d + e + f;
}
`;
    const issues = await runDetector(longParameterListDetector, { "build.ts": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "long-parameter-list");
  });

  it("raises confidence for boolean traps", async () => {
    const src = `
export function render(enabled: boolean, visible: boolean, compact: boolean) {
  return enabled && visible && compact;
}
`;
    const issues = await runDetector(longParameterListDetector, { "render.ts": src });
    assert.equal(issues.length, 1);
    assert.ok((issues[0]?.confidence ?? 0) >= 0.7);
    assert.match(issues[0]?.message ?? "", /boolean/i);
  });

  it("does not flag React props signature", async () => {
    const src = `
export function Dashboard(props: { userId: string; region: string; theme: string }) {
  return props.userId;
}
`;
    const issues = await runDetector(longParameterListDetector, { "Dashboard.tsx": src });
    assert.equal(issues.length, 0);
  });

  it("does not flag reducer state/action signature", async () => {
    const src = `
export function reducer(state: { count: number }, action: { type: string }) {
  return state;
}
`;
    const issues = await runDetector(longParameterListDetector, { "reducer.ts": src });
    assert.equal(issues.length, 0);
  });
});
