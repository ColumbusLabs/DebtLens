import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { largeFunctionDetector } from "../../src/detectors/largeFunction.js";
import { runDetector } from "../helpers/runDetector.js";

describe("large-function detector", () => {
  it("flags a non-component function over the branch budget", async () => {
    const src = `
export function scoreInvoice(invoice) {
  if (invoice.total > 100) return "large";
  if (invoice.total > 50) return "medium";
  if (invoice.discount) return "discounted";
  return "small";
}
`;
    const issues = await runDetector(
      largeFunctionDetector,
      { "billing.ts": src },
      { thresholds: { "large-function.maxBranches": 3 } },
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "large-function");
    assert.match(issues[0]?.message ?? "", /scoreInvoice/);
  });

  it("does NOT flag a React component already covered by large-component", async () => {
    const src = `
export function Dashboard() {
  if (ready) return <Ready />;
  if (loading) return <Spinner />;
  if (error) return <ErrorView />;
  return <Empty />;
}
`;
    const issues = await runDetector(
      largeFunctionDetector,
      { "Dashboard.tsx": src },
      { thresholds: { "large-function.maxBranches": 3 } },
    );
    assert.equal(issues.length, 0);
  });

  it("does NOT flag a small helper inside budget", async () => {
    const src = `
export function normalize(value) {
  return value.trim().toLowerCase();
}
`;
    const issues = await runDetector(
      largeFunctionDetector,
      { "normalize.ts": src },
      { thresholds: { "large-function.maxLines": 10, "large-function.maxBranches": 3 } },
    );
    assert.equal(issues.length, 0);
  });

  it("flags large class methods", async () => {
    const src = `
export class BillingPolicy {
  score(invoice) {
    if (invoice.total > 100) return "large";
    if (invoice.total > 50) return "medium";
    if (invoice.discount) return "discounted";
    return "small";
  }
}
`;
    const issues = await runDetector(
      largeFunctionDetector,
      { "BillingPolicy.ts": src },
      { thresholds: { "large-function.maxBranches": 3 } },
    );
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /score/);
  });

  it("flags large object-literal methods", async () => {
    const src = `
export const billingPolicy = {
  score(invoice) {
    if (invoice.total > 100) return "large";
    if (invoice.total > 50) return "medium";
    if (invoice.discount) return "discounted";
    return "small";
  }
};
`;
    const issues = await runDetector(
      largeFunctionDetector,
      { "billingPolicy.ts": src },
      { thresholds: { "large-function.maxBranches": 3 } },
    );
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /score/);
  });
});
