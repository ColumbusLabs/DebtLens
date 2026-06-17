import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { testDuplicationDetector } from "../../src/detectors/testDuplication.js";
import { runDetector } from "../helpers/runDetector.js";

describe("test-duplication detector", () => {
  it("flags copy-pasted test bodies across test files", async () => {
    const issues = await runDetector(testDuplicationDetector, {
      "src/a.test.ts": `
        test("creates invoice", () => {
          const invoice = createInvoice({ total: 10 });
          expect(invoice.total).toBe(10);
          expect(invoice.status).toBe("open");
        });
      `,
      "src/b.test.ts": `
        test("creates receipt", () => {
          const receipt = createInvoice({ total: 10 });
          expect(receipt.total).toBe(10);
          expect(receipt.status).toBe("open");
        });
      `,
    }, {
      thresholds: { "test-duplication.minLines": 2 },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "test-duplication");
    assert.match(issues[0]?.message ?? "", /similar/);
  });

  it("does not flag parameterized tests", async () => {
    const issues = await runDetector(testDuplicationDetector, {
      "src/a.test.ts": `
        test.each([[1], [2]])("case %#", (value) => {
          expect(value).toBeGreaterThan(0);
          expect(String(value)).toMatch(/\\d/);
        });
      `,
      "src/b.test.ts": `
        test.each([[3], [4]])("case %#", (value) => {
          expect(value).toBeGreaterThan(0);
          expect(String(value)).toMatch(/\\d/);
        });
      `,
    });

    assert.equal(issues.length, 0);
  });
});
