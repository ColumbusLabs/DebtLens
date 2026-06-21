import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyCatchDetector, swallowedErrorDetector } from "../../src/detectors/errorHandling.js";
import { runDetector } from "../helpers/runDetector.js";

describe("empty-catch detector", () => {
  it("flags empty catch blocks", async () => {
    const issues = await runDetector(emptyCatchDetector, {
      "src/worker.ts": `
        export function run() {
          try {
            return risky();
          } catch (error) {
          }
        }
      `,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "empty-catch");
    assert.match(issues[0]?.message ?? "", /empty/i);
  });

  it("flags comment-only catch blocks unless allowCommentOnly is enabled", async () => {
    const source = `
      export function run() {
        try {
          return risky();
        } catch (error) {
          // ignored on purpose
        }
      }
    `;

    const flagged = await runDetector(emptyCatchDetector, { "src/worker.ts": source });
    assert.equal(flagged.length, 1);
    assert.match(flagged[0]?.message ?? "", /comment/i);

    const allowed = await runDetector(emptyCatchDetector, { "src/worker.ts": source }, {
      thresholds: { "empty-catch.allowCommentOnly": 1 },
    });
    assert.equal(allowed.length, 0);
  });

  it("emits raw findings when a central suppression directive is present", async () => {
    const issues = await runDetector(emptyCatchDetector, {
      "src/worker.ts": `
        export function run() {
          try {
            return risky();
          // debtlens-disable-next-line empty-catch -- vendor SDK throws benign noise
          } catch (error) {
          }
        }
      `,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "empty-catch");
  });
});

describe("swallowed-error detector", () => {
  it("flags log-only catch blocks", async () => {
    const issues = await runDetector(swallowedErrorDetector, {
      "src/worker.ts": `
        export function run() {
          try {
            return risky();
          } catch (error) {
            console.error(error);
          }
        }
      `,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "swallowed-error");
    assert.match(issues[0]?.message ?? "", /logs the error/i);
  });

  it("does not flag catch blocks that rethrow", async () => {
    const issues = await runDetector(swallowedErrorDetector, {
      "src/worker.ts": `
        export function run() {
          try {
            return risky();
          } catch (error) {
            console.error(error);
            throw error;
          }
        }
      `,
    });

    assert.equal(issues.length, 0);
  });

  it("emits raw findings when a central suppression directive is present", async () => {
    const issues = await runDetector(swallowedErrorDetector, {
      "src/worker.ts": `
        export function run() {
          try {
            return risky();
          // debtlens-disable-next-line swallowed-error -- logged for support triage only
          } catch (error) {
            console.error(error);
          }
        }
      `,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "swallowed-error");
  });
});
