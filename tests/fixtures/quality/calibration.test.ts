import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../../src/config/defaults.js";
import { scan } from "../../../src/core/scan.js";

interface CalibrationCase {
  id: string;
  target: string;
  minSeverity: "info" | "low" | "medium" | "high";
  minIssuesByRule: Record<string, number>;
  maxIssuesByRule: Record<string, number>;
  mustNotIncludeRules?: string[];
}

const cases: CalibrationCase[] = [
  {
    id: "examples-react",
    target: "examples/react",
    minSeverity: "low",
    minIssuesByRule: {
      "duplicate-logic": 1,
      "prop-drilling": 1,
      "state-sprawl": 1,
      "effect-complexity": 1,
      "todo-comment": 1,
    },
    maxIssuesByRule: {
      "duplicate-logic": 2,
      "prop-drilling": 2,
      "state-sprawl": 2,
      "effect-complexity": 2,
      "todo-comment": 2,
      "dead-abstraction": 5,
    },
    mustNotIncludeRules: ["large-component"],
  },
  {
    id: "examples-next",
    target: "examples/next",
    minSeverity: "info",
    minIssuesByRule: {
      "dead-abstraction": 1,
    },
    maxIssuesByRule: {
      "dead-abstraction": 2,
      "large-component": 0,
      "state-sprawl": 0,
    },
  },
];

describe("calibrated quality fixtures", () => {
  for (const calibration of cases) {
    it(`matches expected finding bounds for ${calibration.id}`, async () => {
      const result = await scan({
        cwd: process.cwd(),
        target: resolve(calibration.target),
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: calibration.minSeverity,
        rules: undefined,
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
        respectGitignore: defaultConfig.respectGitignore,
      });

      const counts = result.issues.reduce<Record<string, number>>((accumulator, issue) => {
        accumulator[issue.ruleId] = (accumulator[issue.ruleId] ?? 0) + 1;
        return accumulator;
      }, {});

      for (const [ruleId, minimum] of Object.entries(calibration.minIssuesByRule)) {
        assert.ok((counts[ruleId] ?? 0) >= minimum, `${calibration.id}: expected at least ${minimum} ${ruleId} findings`);
      }

      for (const [ruleId, maximum] of Object.entries(calibration.maxIssuesByRule)) {
        assert.ok((counts[ruleId] ?? 0) <= maximum, `${calibration.id}: expected at most ${maximum} ${ruleId} findings`);
      }

      for (const ruleId of calibration.mustNotIncludeRules ?? []) {
        assert.equal(counts[ruleId] ?? 0, 0, `${calibration.id}: ${ruleId} should not fire`);
      }
    });
  }
});
