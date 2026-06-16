import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { weakTestBoundaryDetector } from "../../src/detectors/weakTestBoundary.js";
import { runDetector } from "../helpers/runDetector.js";

describe("weak-test-boundary detector", () => {
  it("flags production imports from __tests__", async () => {
    const src = `
import { makeInvoice } from "./__tests__/fixtures";
export const invoice = makeInvoice();
`;
    const issues = await runDetector(weakTestBoundaryDetector, { "src/billing.ts": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "weak-test-boundary");
    assert.match(issues[0]?.message ?? "", /__tests__/);
  });

  it("flags production imports from test files and mocks", async () => {
    const src = `
import { fakeClock } from "../time.test";
const mockGateway = require("./__mocks__/gateway");
export { fakeClock, mockGateway };
`;
    const issues = await runDetector(weakTestBoundaryDetector, { "src/payments.ts": src });
    assert.equal(issues.length, 2);
  });

  it("does NOT flag test files importing other test helpers", async () => {
    const src = `
import { makeInvoice } from "../__tests__/fixtures";
import { fakeClock } from "../time.test";
test("works", () => makeInvoice(fakeClock));
`;
    const issues = await runDetector(weakTestBoundaryDetector, { "src/billing.test.ts": src });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag production imports from normal support modules", async () => {
    const src = `
import { makeInvoice } from "./support/fixtures";
export const invoice = makeInvoice();
`;
    const issues = await runDetector(weakTestBoundaryDetector, { "src/billing.ts": src });
    assert.equal(issues.length, 0);
  });
});
