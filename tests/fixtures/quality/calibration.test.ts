import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../../src/config/defaults.js";
import { getRulePack } from "../../../src/config/packs.js";
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
      "server-client-boundary": 1,
      "route-handler-size": 1,
      "data-loader-sprawl": 1,
    },
    maxIssuesByRule: {
      "dead-abstraction": 2,
      "server-client-boundary": 2,
      "route-handler-size": 2,
      "data-loader-sprawl": 2,
      "large-component": 0,
      "state-sprawl": 0,
    },
  },
  {
    id: "examples-node-api-core",
    target: "examples/node-api",
    minSeverity: "info",
    minIssuesByRule: {
      "duplicate-logic": 1,
      "todo-comment": 1,
    },
    maxIssuesByRule: {
      "duplicate-logic": 1,
      "todo-comment": 1,
      "dead-abstraction": 0,
      "naming-drift": 0,
    },
    mustNotIncludeRules: ["large-component", "state-sprawl", "effect-complexity", "prop-drilling"],
  },
  {
    id: "examples-python",
    target: "examples/python",
    minSeverity: "info",
    minIssuesByRule: {
      "python-duplicate-logic": 1,
      "python-large-function": 1,
      "python-complex-control-flow": 1,
      "python-dead-abstraction": 1,
      "python-todo-comment": 1,
    },
    maxIssuesByRule: {
      "python-duplicate-logic": 2,
      "python-large-function": 1,
      "python-complex-control-flow": 1,
      "python-dead-abstraction": 1,
      "python-todo-comment": 1,
    },
  },
];

const falsePositiveCases = [
  { ruleId: "dead-abstraction", target: "examples/false-positives/dead-abstraction" },
  { ruleId: "duplicate-logic", target: "examples/false-positives/duplicate-logic" },
  { ruleId: "effect-complexity", target: "examples/false-positives/effect-complexity" },
  { ruleId: "large-component", target: "examples/false-positives/large-component" },
  { ruleId: "naming-drift", target: "examples/false-positives/naming-drift" },
  { ruleId: "prop-drilling", target: "examples/false-positives/prop-drilling" },
  { ruleId: "state-sprawl", target: "examples/false-positives/state-sprawl" },
  { ruleId: "todo-comment", target: "examples/false-positives/todo-comment" },
  { ruleId: "compose-large-composable", target: "examples/false-positives/compose", include: ["**/*.{kt,kts}"] },
  { ruleId: "compose-state-hoisting", target: "examples/false-positives/compose", include: ["**/*.{kt,kts}"] },
] as const;

describe("calibrated quality fixtures", () => {
  for (const calibration of cases) {
    it(`matches expected finding bounds for ${calibration.id}`, async () => {
      const result = await scan({
        cwd: process.cwd(),
        target: resolve(calibration.target),
        include: calibration.id === "examples-python" ? ["**/*.py"] : defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: calibration.minSeverity,
        rules: calibration.id === "examples-node-api-core"
          ? getRulePack("core").rules
          : calibration.id === "examples-python"
            ? getRulePack("python").rules
            : undefined,
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

  for (const calibration of falsePositiveCases) {
    it(`keeps ${calibration.ruleId} quiet for its false-positive playground`, async () => {
      const result = await scan({
        cwd: process.cwd(),
        target: resolve(calibration.target),
        include: "include" in calibration ? [...calibration.include] : defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "info",
        rules: [calibration.ruleId],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
        respectGitignore: defaultConfig.respectGitignore,
      });

      assert.equal(result.summary.totalIssues, 0, `${calibration.ruleId}: expected no playground findings`);
    });
  }
});
