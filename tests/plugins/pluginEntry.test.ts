import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DEBTLENS_PLUGIN_API_VERSION } from "../../src/plugin.js";
import type { DebtIssue, Detector, DetectorContext, Severity } from "../../src/plugin.js";

describe("debtlens/plugin entry point", () => {
  it("exports the plugin API version", () => {
    assert.equal(DEBTLENS_PLUGIN_API_VERSION, 1);
  });

  it("exposes the detector contract types", () => {
    // Compile-time assertion: a detector written against the public entry
    // type-checks (verified by npm run typecheck:tests).
    const severity: Severity = "low";
    const detector: Detector = {
      id: "entry-check",
      name: "Entry check",
      description: "Types-only detector exercising the published surface.",
      defaultSeverity: severity,
      tags: [],
      detect: (context: DetectorContext): DebtIssue[] => {
        void context.getThreshold("entry-check.max", 1);
        return [];
      },
    };

    assert.equal(detector.id, "entry-check");
  });

  it("is published via the package exports map", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports?: Record<string, { types?: string; import?: string }>;
    };

    assert.equal(packageJson.exports?.["./plugin"]?.types, "./dist/plugin.d.ts");
    assert.equal(packageJson.exports?.["./plugin"]?.import, "./dist/plugin.js");
  });
});
