import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { complexControlFlowDetector } from "../../src/detectors/complexControlFlow.js";
import { runDetector } from "../helpers/runDetector.js";

describe("complex-control-flow detector", () => {
  it("flags nested switch and branch-heavy functions", async () => {
    const issues = await runDetector(complexControlFlowDetector, {
      "src/router.ts": `
        export function decide(input: string, enabled: boolean) {
          switch (input) {
            case "a":
              if (enabled) {
                for (const item of [1, 2, 3]) {
                  if (item > 1) return item;
                }
              }
              break;
            case "b":
              try {
                return enabled ? 1 : 0;
              } catch {
                return 0;
              }
            default:
              while (enabled) return 2;
          }
          return 0;
        }
      `,
    }, {
      thresholds: {
        "complex-control-flow.maxComplexity": 8,
        "complex-control-flow.maxDepth": 4,
      },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "complex-control-flow");
    assert.match(issues[0]?.evidence?.join("\n") ?? "", /Complexity score:/);
  });

  it("does not flag simple functions", async () => {
    const issues = await runDetector(complexControlFlowDetector, {
      "src/simple.ts": `
        export function label(value: number) {
          if (value > 0) return "positive";
          return "zero";
        }
      `,
    });

    assert.equal(issues.length, 0);
  });
});
