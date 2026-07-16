import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { featureFlagDebtDetector } from "../../src/detectors/featureFlagDebt.js";
import { runDetector } from "../helpers/runDetector.js";

describe("stale-feature-flag detector", () => {
  it("flags a hardcoded flag constant used in conditional control flow", async () => {
    const issues = await runDetector(featureFlagDebtDetector, {
      "checkout.ts": `
const enableNewCheckout = true;
export function render() {
  return enableNewCheckout ? "new" : "old";
}
`,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "stale-feature-flag");
    assert.match(issues[0]?.message ?? "", /hardcoded to true/);
  });

  it("ignores flag-like booleans that do not control a branch", async () => {
    const issues = await runDetector(featureFlagDebtDetector, {
      "telemetry.ts": `
export const enabledTelemetry = true;
console.log(enabledTelemetry);
`,
    });

    assert.equal(issues.length, 0);
  });

  it("finds hardcoded and unreferenced keys in configured registry files", async () => {
    const issues = await runDetector(featureFlagDebtDetector, {
      "src/flags/registry.ts": `
export const featureFlags = {
  "new-checkout": true,
  abandonedSearch: false,
};
`,
      "src/checkout.ts": `
export function checkout() {
  if (featureClient.enabled("tenant", "new-checkout")) return "new";
  return "old";
}
`,
    }, {
      featureFlags: {
        registryGlobs: ["src/flags/**"],
        accessPatterns: [{ callee: "featureClient.enabled", keyArgument: 1 }],
        constantNamePatterns: [],
      },
    });

    assert.equal(issues.length, 2);
    assert.ok(issues.some((issue) => /new-checkout is hardcoded to true/.test(issue.message)));
    assert.ok(issues.some((issue) => /abandonedSearch.*never referenced/.test(issue.message)));
  });

  it("aggregates exported constant references across files", async () => {
    const issues = await runDetector(featureFlagDebtDetector, {
      "src/flags.ts": "export const enableCheckout = true;\n",
      "src/app.ts": `
import { enableCheckout } from "./flags";
export const route = enableCheckout ? "/new" : "/old";
`,
    }, {
      featureFlags: {
        registryGlobs: ["src/flags.ts"],
        accessPatterns: [],
        constantNamePatterns: [],
      },
    });

    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /hardcoded/);
    assert.doesNotMatch(issues[0]?.message ?? "", /never referenced/);
  });

  it("combines configured-key references with registry constant symbols", async () => {
    const conditionalIssues = await runDetector(featureFlagDebtDetector, {
      "flags.ts": "export const checkout = true;\n",
      "app.ts": "if (isEnabled(\"checkout\")) launch();\n",
    }, {
      featureFlags: {
        registryGlobs: ["flags.ts"],
        accessPatterns: [{ callee: "isEnabled" }],
        constantNamePatterns: [],
      },
    });
    const nonConditionalIssues = await runDetector(featureFlagDebtDetector, {
      "flags.ts": "export const checkout = true;\n",
      "app.ts": "export const active = isEnabled(\"checkout\");\n",
    }, {
      featureFlags: {
        registryGlobs: ["flags.ts"],
        accessPatterns: [{ callee: "isEnabled" }],
        constantNamePatterns: [],
      },
    });

    assert.equal(conditionalIssues.length, 1);
    assert.match(conditionalIssues[0]?.message ?? "", /hardcoded to true/);
    assert.doesNotMatch(conditionalIssues[0]?.message ?? "", /never referenced/);
    assert.equal(nonConditionalIssues.length, 0);
  });

  it("recognizes direct registry property checks", async () => {
    const issues = await runDetector(featureFlagDebtDetector, {
      "flags.ts": "export const flags = { checkout: false };\n",
      "app.ts": "if (flags.checkout) launch();\n",
    }, {
      featureFlags: {
        registryGlobs: ["flags.ts"],
        accessPatterns: [],
        constantNamePatterns: [],
      },
    });

    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /checkout is hardcoded to false/);
  });

  it("suppresses unreferenced claims when configured access uses a dynamic key", async () => {
    const issues = await runDetector(featureFlagDebtDetector, {
      "flags.ts": "export const flags = { checkout: true };\n",
      "app.ts": "if (isEnabled(flagName)) launch();\n",
    }, {
      featureFlags: {
        registryGlobs: ["flags.ts"],
        accessPatterns: [{ callee: "isEnabled" }],
        constantNamePatterns: [],
      },
    });

    assert.equal(issues.length, 0);
  });

  it("suppresses unreferenced claims when direct element access uses a dynamic key", async () => {
    const issues = await runDetector(featureFlagDebtDetector, {
      "flags.ts": "export const flags = { checkout: true, search: false };\n",
      "app.ts": "if (flags[currentFlag]) launch();\n",
    }, {
      featureFlags: {
        registryGlobs: ["flags.ts"],
        accessPatterns: [],
        constantNamePatterns: [],
      },
    });

    assert.equal(issues.length, 0);
  });

  it("keeps same-named non-registry constants scoped conservatively", async () => {
    const issues = await runDetector(featureFlagDebtDetector, {
      "one.ts": "const enableCheckout = true;\nexport const one = enableCheckout ? 1 : 0;\n",
      "two.ts": "const enableCheckout = true;\nexport const two = enableCheckout ? 2 : 0;\n",
    });

    assert.equal(issues.length, 2);
    assert.deepEqual(issues.map((issue) => issue.file).sort(), ["one.ts", "two.ts"]);
  });
});
