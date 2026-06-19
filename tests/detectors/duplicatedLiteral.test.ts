import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { duplicatedLiteralDetector } from "../../src/detectors/duplicatedLiteral.js";
import { runDetector } from "../helpers/runDetector.js";

describe("duplicated-literal detector", () => {
  it("flags a repeated string literal across files", async () => {
    const issues = await runDetector(duplicatedLiteralDetector, {
      "billing.ts": `
export const overdue = "payment-overdue";
export const copy = "payment-overdue";
`,
      "notifications.ts": `
export function status() {
  return "payment-overdue";
}
`,
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "duplicated-literal");
    assert.match(issues[0]?.message ?? "", /payment-overdue/);
  });

  it("flags a repeated number literal across files", async () => {
    const issues = await runDetector(
      duplicatedLiteralDetector,
      {
        "retry.ts": `export const delay = 120000; export const maxDelay = 120000;`,
        "queue.ts": `export function timeout() { return 120000; }`,
      },
      { thresholds: { "duplicated-literal.minCount": 3 } },
    );
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /120000/);
  });

  it("does NOT flag single-file repetition", async () => {
    const issues = await runDetector(duplicatedLiteralDetector, {
      "billing.ts": `
export const a = "payment-overdue";
export const b = "payment-overdue";
export const c = "payment-overdue";
`,
      "notifications.ts": `export const status = "payment-ready";`,
    });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag common short literals", async () => {
    const issues = await runDetector(duplicatedLiteralDetector, {
      "a.ts": `export const idA = "id"; export const zero = 0;`,
      "b.ts": `export const idB = "id"; export const otherZero = 0;`,
      "c.ts": `export const idC = "id"; export const lastZero = 0;`,
    });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag short repeated number literals by default", async () => {
    const issues = await runDetector(duplicatedLiteralDetector, {
      "grid.ts": `export const columns = 3; export const minColumns = 3;`,
      "layout.ts": `export function defaultColumns() { return 3; }`,
    });
    assert.equal(issues.length, 0);
  });

  it("ignores configured framework string literals", async () => {
    const issues = await runDetector(
      duplicatedLiteralDetector,
      {
        "app/dashboard/ClientOne.tsx": `"use client";
export function ClientOne() {
  return <button>One</button>;
}
`,
        "app/settings/ClientTwo.tsx": `"use client";
export function ClientTwo() {
  return <button>Two</button>;
}
`,
        "app/reports/ClientThree.tsx": `"use client";
export function ClientThree() {
  return <button>Three</button>;
}
`,
      },
      { duplicatedLiteralIgnoreStrings: ["use client"] },
    );

    assert.equal(issues.length, 0);
  });

  it("still flags meaningful duplicated strings when custom ignores are configured", async () => {
    const issues = await runDetector(
      duplicatedLiteralDetector,
      {
        "billing.ts": `
export const status = "payment-overdue";
export const ignored = "use client";
`,
        "notifications.ts": `
export const status = "payment-overdue";
export const ignored = "use client";
`,
        "reports.ts": `
export const status = "payment-overdue";
export const ignored = "use client";
`,
      },
      { duplicatedLiteralIgnoreStrings: ["use client"] },
    );

    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /payment-overdue/);
  });
});
