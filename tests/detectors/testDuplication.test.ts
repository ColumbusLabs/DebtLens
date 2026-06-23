import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
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

  it("does not side-load nested dependency tests", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-test-duplication-deps-"));
    try {
      mkdirSync(join(dir, "packages", "sim", "tests"), { recursive: true });
      mkdirSync(join(dir, "apps", "game", "node_modules", "@scope", "sim", "tests"), { recursive: true });
      const testBody = `
        test("replay command sequence is deterministic", () => {
          const replay = runReplay(["start", "fund", "recover"]);
          expect(replay.timeline).toHaveLength(3);
          expect(replay.outcome).toBe("stable");
        });
      `;
      writeFileSync(join(dir, "packages", "sim", "tests", "regression.test.ts"), testBody);
      writeFileSync(join(dir, "apps", "game", "node_modules", "@scope", "sim", "tests", "regression.test.ts"), testBody);

      const issues = await runDetector(testDuplicationDetector, {}, {
        target: dir,
        exclude: defaultConfig.exclude,
        thresholds: { "test-duplication.minLines": 2 },
      });

      assert.equal(issues.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("anchors changed-mode findings to changed tests without leaking unrelated duplicate pairs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-test-duplication-changed-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "changed.test.ts"), `
        test("creates invoice from changed file", () => {
          const invoice = createInvoice({ total: 10 });
          expect(invoice.total).toBe(10);
          expect(invoice.status).toBe("open");
        });
      `);
      writeFileSync(join(dir, "src", "existing.test.ts"), `
        test("creates receipt from existing file", () => {
          const receipt = createInvoice({ total: 10 });
          expect(receipt.total).toBe(10);
          expect(receipt.status).toBe("open");
        });
      `);
      writeFileSync(join(dir, "src", "old-a.test.ts"), `
        test("old duplicate a", () => {
          const customer = createCustomer({ plan: "pro" });
          expect(customer.plan).toBe("pro");
          expect(customer.active).toBe(true);
        });
      `);
      writeFileSync(join(dir, "src", "old-b.test.ts"), `
        test("old duplicate b", () => {
          const user = createCustomer({ plan: "pro" });
          expect(user.plan).toBe("pro");
          expect(user.active).toBe(true);
        });
      `);

      const issues = await runDetector(testDuplicationDetector, {}, {
        target: dir,
        changedFiles: [join(dir, "src", "changed.test.ts")],
        thresholds: { "test-duplication.minLines": 2 },
      });

      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.file, "src/changed.test.ts");
      assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("src/existing.test.ts")));
      assert.ok(!issues[0]?.evidence?.some((entry) => entry.includes("src/old-a.test.ts")));
      assert.ok(!issues[0]?.evidence?.some((entry) => entry.includes("src/old-b.test.ts")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
