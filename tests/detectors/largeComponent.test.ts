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

  it("flags a memo-wrapped component over the hook budget", async () => {
    const src = `
import { memo } from "react";
export const Screen = memo(function Screen() {
  const a = useState(0);
  const b = useState(0);
  const c = useState(0);
  const d = useState(0);
  return <div />;
});
`;
    const issues = await runDetector(
      largeComponentDetector,
      { "Screen.tsx": src },
      { thresholds: { "large-component.maxHooks": 3 } },
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "large-component");
    assert.match(issues[0]?.message ?? "", /Screen/);
  });

  it("flags a forwardRef-wrapped component over the hook budget", async () => {
    const src = `
import { forwardRef } from "react";
export const Input = forwardRef(function Input(_props, ref) {
  const a = useState(0);
  const b = useState(0);
  const c = useState(0);
  const d = useState(0);
  return <input ref={ref} />;
});
`;
    const issues = await runDetector(
      largeComponentDetector,
      { "Input.tsx": src },
      { thresholds: { "large-component.maxHooks": 3 } },
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "large-component");
    assert.match(issues[0]?.message ?? "", /Input/);
  });

  it("does NOT flag a small memo-wrapped component within budget", async () => {
    const src = `
import { memo } from "react";
export const Screen = memo(function Screen() {
  const a = useState(0);
  return <div>{a}</div>;
});
`;
    const issues = await runDetector(
      largeComponentDetector,
      { "Screen.tsx": src },
      { thresholds: { "large-component.maxHooks": 3 } },
    );
    assert.equal(issues.length, 0);
  });

  it("flags a class component over the line budget", async () => {
    const src = `
import { Component } from "react";
export class Dashboard extends Component {
  render() {
    const rows = [];
    rows.push(1);
    rows.push(2);
    rows.push(3);
    rows.push(4);
    rows.push(5);
    rows.push(6);
    return <div>{rows.length}</div>;
  }
}
`;
    const issues = await runDetector(
      largeComponentDetector,
      { "Dashboard.tsx": src },
      { thresholds: { "large-component.maxLines": 8 } },
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "large-component");
    assert.match(issues[0]?.message ?? "", /Dashboard/);
  });
});
