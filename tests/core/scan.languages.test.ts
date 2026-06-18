import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { scan } from "../../src/core/scan.js";

describe("scan language-specific behavior", () => {
  it("lets test-duplication inspect test files without widening default source includes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-test-duplication-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "a.test.ts"), `
        test("creates invoice", () => {
          const invoice = createInvoice({ total: 10 });
          expect(invoice.total).toBe(10);
          expect(invoice.status).toBe("open");
        });
      `);
      writeFileSync(join(dir, "src", "b.test.ts"), `
        test("creates receipt", () => {
          const receipt = createInvoice({ total: 10 });
          expect(receipt.total).toBe(10);
          expect(receipt.status).toBe("open");
        });
      `);

      const result = await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: ["test-duplication"],
        thresholds: { ...defaultConfig.thresholds, "test-duplication.minLines": 2 },
        maxFiles: defaultConfig.maxFiles,
      });

      assert.equal(result.summary.filesScanned, 0);
      assert.equal(result.summary.totalIssues, 1);
      assert.equal(result.issues[0]?.ruleId, "test-duplication");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
