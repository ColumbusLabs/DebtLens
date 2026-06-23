import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cognitiveComplexityDetector } from "../../src/detectors/cognitiveComplexity.js";
import { runDetector } from "../helpers/runDetector.js";

describe("cognitive-complexity detector", () => {
  it("flags deeply nested control flow", async () => {
    const src = `
export function review(input: { a?: boolean; b?: boolean; c?: boolean; d?: boolean }) {
  if (input.a) {
    if (input.b) {
      if (input.c) {
        if (input.d) {
          return "nested";
        }
      }
    }
  }
  return "ok";
}
`;
    const issues = await runDetector(cognitiveComplexityDetector, { "review.ts": src }, {
      thresholds: { "cognitive-complexity.max": 5 },
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "cognitive-complexity");
  });

  it("does not flag a flat switch with low nesting", async () => {
    const src = `
export function status(code: number) {
  switch (code) {
    case 200: return "ok";
    case 404: return "missing";
    case 500: return "error";
    default: return "unknown";
  }
}
`;
    const issues = await runDetector(cognitiveComplexityDetector, { "status.ts": src }, {
      thresholds: { "cognitive-complexity.max": 15 },
    });
    assert.equal(issues.length, 0);
  });
});
