import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeConfig } from "../../src/config/mergeConfig.js";
import { getRulePack, listRulePacks } from "../../src/config/packs.js";

describe("rule packs", () => {
  it("lists built-in packs with expected rule counts", () => {
    const packs = listRulePacks();
    assert.equal(packs.length, 14);
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
    assert.deepEqual(getRulePack("python-web").rules, [
      "python-duplicate-logic",
      "python-large-function",
      "python-complex-control-flow",
      "python-dead-abstraction",
      "python-todo-comment",
      "python-route-sprawl",
    ]);
    assert.deepEqual(getRulePack("python-web").languages, ["python"]);
    assert.equal(getRulePack("python-web").thresholds?.["python-route-sprawl.maxRoutes"], 8);
    assert.deepEqual(getRulePack("vue").rules, [
      "vue-todo-comment",
      "vue-large-script",
      "vue-duplicate-logic",
    ]);
    assert.deepEqual(getRulePack("vue").languages, ["vue"]);
    assert.equal(getRulePack("vue").thresholds?.["vue-large-script.maxFunctionLines"], 80);
    assert.deepEqual(getRulePack("svelte").rules, [
      "svelte-todo-comment",
      "svelte-large-script",
      "svelte-duplicate-logic",
    ]);
    assert.deepEqual(getRulePack("svelte").languages, ["svelte"]);
    assert.equal(getRulePack("svelte").thresholds?.["svelte-large-script.maxFunctionLines"], 80);
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
    assert.throws(() => getRulePack("ember"), /Unknown rule pack "ember"/);
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
    const options = mergeConfig(".", {}, { cwd: process.cwd(), pack: "core,python-web,vue,svelte,kotlin,compose" });

    assert.equal(options.pack, "core,python-web,vue,svelte,kotlin,compose");
    assert.ok(options.rules?.includes("todo-comment"));
    assert.ok(options.rules?.includes("python-todo-comment"));
    assert.ok(options.rules?.includes("python-route-sprawl"));
    assert.ok(options.rules?.includes("vue-todo-comment"));
    assert.ok(options.rules?.includes("svelte-todo-comment"));
    assert.ok(options.rules?.includes("kotlin-todo-comment"));
    assert.ok(options.rules?.includes("compose-large-composable"));
    assert.ok(options.include.includes("**/*.py"));
    assert.ok(options.include.includes("**/*.vue"));
    assert.ok(options.include.includes("**/*.svelte"));
    assert.ok(options.include.includes("**/*.{kt,kts}"));
    assert.equal(options.exclude.includes("android/**"), false);
  });

  it("widens includes for explicit language-specific rules", () => {
    const options = mergeConfig(".", {}, { cwd: process.cwd(), rules: ["kotlin-todo-comment"] });

    assert.deepEqual(options.rules, ["kotlin-todo-comment"]);
    assert.equal(options.include.includes("**/*.{ts,tsx,js,jsx}"), false);
    assert.ok(options.include.includes("**/*.{kt,kts}"));
  });

  it("widens includes for explicit SFC rules", () => {
    const options = mergeConfig(".", {}, { cwd: process.cwd(), rules: ["vue-todo-comment", "svelte-large-script"] });

    assert.deepEqual(options.rules, ["vue-todo-comment", "svelte-large-script"]);
    assert.equal(options.include.includes("**/*.{ts,tsx,js,jsx}"), false);
    assert.ok(options.include.includes("**/*.vue"));
    assert.ok(options.include.includes("**/*.svelte"));
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
    const options = mergeConfig(".", {}, { cwd: process.cwd(), pack: "python-web,vue,svelte,compose" });

    assert.deepEqual(options.rules, [
      "python-duplicate-logic",
      "python-large-function",
      "python-complex-control-flow",
      "python-dead-abstraction",
      "python-todo-comment",
      "python-route-sprawl",
      "vue-todo-comment",
      "vue-large-script",
      "vue-duplicate-logic",
      "svelte-todo-comment",
      "svelte-large-script",
      "svelte-duplicate-logic",
      "compose-large-composable",
      "compose-state-hoisting",
    ]);
    assert.deepEqual(options.include, ["**/*.py", "**/*.vue", "**/*.svelte", "**/*.{kt,kts}"]);
  });
});
