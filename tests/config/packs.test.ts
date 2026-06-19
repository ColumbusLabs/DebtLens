import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeConfig } from "../../src/config/mergeConfig.js";
import { getRulePack, listRulePacks } from "../../src/config/packs.js";

describe("rule packs", () => {
  it("lists built-in packs with expected rule counts", () => {
    const packs = listRulePacks();
    assert.equal(packs.length, 11);
    assert.equal(getRulePack("core").rules.length, 13);
    assert.deepEqual(getRulePack("core").languages, ["tsjs"]);
    assert.equal(getRulePack("react").rules.length, 20);
    assert.equal(getRulePack("react-native").rules.length, 21);
    assert.ok(getRulePack("react-native").rules.includes("rn-host-forwarding"));
    assert.equal(getRulePack("next").rules.length, 23);
    assert.ok(getRulePack("next").rules.includes("server-client-boundary"));
    assert.ok(getRulePack("next").rules.includes("route-handler-size"));
    assert.ok(getRulePack("next").rules.includes("data-loader-sprawl"));
    assert.deepEqual(getRulePack("next").duplicatedLiteral?.ignoreStrings, ["use client", "use server"]);
    assert.equal(getRulePack("expo").rules.length, 21);
    assert.ok(getRulePack("node").rules.includes("handler-depth"));
    assert.ok(getRulePack("node").rules.includes("route-sprawl"));
    assert.deepEqual(getRulePack("python").rules, [
      "python-duplicate-logic",
      "python-large-function",
      "python-complex-control-flow",
      "python-dead-abstraction",
      "python-todo-comment",
    ]);
    assert.deepEqual(getRulePack("python").languages, ["python"]);
    assert.deepEqual(getRulePack("kotlin").rules, [
      "kotlin-duplicate-logic",
      "kotlin-large-function",
      "kotlin-dead-abstraction",
      "kotlin-todo-comment",
    ]);
    assert.deepEqual(getRulePack("kotlin").languages, ["kotlin"]);
    assert.deepEqual(getRulePack("compose").rules, [
      "compose-large-composable",
      "compose-state-hoisting",
    ]);
    assert.deepEqual(getRulePack("compose").languages, ["kotlin"]);
    assert.ok(getRulePack("ai-assisted-maintainer").rules.includes("duplicated-literal"));
    assert.ok(getRulePack("oss-maintainer").rules.includes("api-surface-sprawl"));
  });

  it("throws for unknown pack ids", () => {
    assert.throws(() => getRulePack("vue"), /Unknown rule pack "vue"/);
  });

  it("applies pack rules when no explicit rules are configured", () => {
    const options = mergeConfig(".", { pack: "core" }, { cwd: process.cwd() });
    assert.equal(options.pack, "core");
    assert.deepEqual(options.rules, getRulePack("core").rules);
  });

  it("applies pack threshold presets below config and CLI overrides", () => {
    const packOnly = mergeConfig(".", { pack: "react-native" }, { cwd: process.cwd() });
    const options = mergeConfig(
      ".",
      { pack: "react-native", thresholds: { "prop-drilling.maxForwardedProps": 7 } },
      { cwd: process.cwd(), thresholds: { "large-component.maxLines": 180 } },
    );

    assert.equal(packOnly.thresholds["prop-drilling.maxForwardedProps"], 5);
    assert.equal(packOnly.thresholds["rn-host-forwarding.maxForwardedProps"], 6);
    assert.equal(options.thresholds["prop-drilling.maxForwardedProps"], 7);
    assert.equal(options.thresholds["large-component.maxLines"], 180);
  });

  it("merges pack duplicated-literal ignores below user config", () => {
    const options = mergeConfig(
      ".",
      { pack: "next", duplicatedLiteral: { ignoreStrings: ["runtime constant"] } },
      { cwd: process.cwd() },
    );

    assert.deepEqual(options.duplicatedLiteralIgnoreStrings, ["use client", "use server", "runtime constant"]);
  });

  it("lets explicit config rules override a pack", () => {
    const options = mergeConfig(".", { pack: "core", rules: ["todo-comment"] }, { cwd: process.cwd() });
    assert.deepEqual(options.rules, ["todo-comment"]);
  });

  it("lets CLI rules override a pack", () => {
    const options = mergeConfig(".", { pack: "react" }, { cwd: process.cwd(), rules: ["naming-drift"] });
    assert.deepEqual(options.rules, ["naming-drift"]);
  });

  it("combines comma-separated packs and widens includes for language packs", () => {
    const options = mergeConfig(".", {}, { cwd: process.cwd(), pack: "core,python,kotlin,compose" });

    assert.equal(options.pack, "core,python,kotlin,compose");
    assert.ok(options.rules?.includes("todo-comment"));
    assert.ok(options.rules?.includes("python-todo-comment"));
    assert.ok(options.rules?.includes("kotlin-todo-comment"));
    assert.ok(options.rules?.includes("compose-large-composable"));
    assert.ok(options.include.includes("**/*.py"));
    assert.ok(options.include.includes("**/*.{kt,kts}"));
    assert.equal(options.exclude.includes("android/**"), false);
  });

  it("widens includes for explicit language-specific rules", () => {
    const options = mergeConfig(".", {}, { cwd: process.cwd(), rules: ["kotlin-todo-comment"] });

    assert.deepEqual(options.rules, ["kotlin-todo-comment"]);
    assert.equal(options.include.includes("**/*.{ts,tsx,js,jsx}"), false);
    assert.ok(options.include.includes("**/*.{kt,kts}"));
  });

  it("lets the Compose pack discover Kotlin without selecting generic Kotlin rules", () => {
    const options = mergeConfig(".", {}, { cwd: process.cwd(), pack: "compose" });

    assert.deepEqual(options.rules, ["compose-large-composable", "compose-state-hoisting"]);
    assert.deepEqual(options.include, ["**/*.{kt,kts}"]);
    assert.equal(options.exclude.includes("android/**"), false);
  });

  it("widens includes for explicit Compose rules", () => {
    const options = mergeConfig(".", {}, { cwd: process.cwd(), rules: ["compose-large-composable"] });

    assert.deepEqual(options.rules, ["compose-large-composable"]);
    assert.equal(options.include.includes("**/*.{ts,tsx,js,jsx}"), false);
    assert.ok(options.include.includes("**/*.{kt,kts}"));
  });

  it("derives pack includes from language metadata", () => {
    const options = mergeConfig(".", {}, { cwd: process.cwd(), pack: "python,compose" });

    assert.deepEqual(options.rules, [
      "python-duplicate-logic",
      "python-large-function",
      "python-complex-control-flow",
      "python-dead-abstraction",
      "python-todo-comment",
      "compose-large-composable",
      "compose-state-hoisting",
    ]);
    assert.deepEqual(options.include, ["**/*.py", "**/*.{kt,kts}"]);
  });
});
