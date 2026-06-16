import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeConfig } from "../../src/config/mergeConfig.js";
import { getRulePack, listRulePacks } from "../../src/config/packs.js";

describe("rule packs", () => {
  it("lists built-in packs with expected rule counts", () => {
    const packs = listRulePacks();
    assert.equal(packs.length, 7);
    assert.equal(getRulePack("core").rules.length, 9);
    assert.equal(getRulePack("react").rules.length, 16);
    assert.deepEqual(getRulePack("react-native").rules, getRulePack("react").rules);
    assert.deepEqual(getRulePack("next").rules, getRulePack("react").rules);
    assert.deepEqual(getRulePack("expo").rules, getRulePack("react").rules);
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
    assert.equal(options.thresholds["prop-drilling.maxForwardedProps"], 7);
    assert.equal(options.thresholds["large-component.maxLines"], 180);
  });

  it("lets explicit config rules override a pack", () => {
    const options = mergeConfig(".", { pack: "core", rules: ["todo-comment"] }, { cwd: process.cwd() });
    assert.deepEqual(options.rules, ["todo-comment"]);
  });

  it("lets CLI rules override a pack", () => {
    const options = mergeConfig(".", { pack: "react" }, { cwd: process.cwd(), rules: ["naming-drift"] });
    assert.deepEqual(options.rules, ["naming-drift"]);
  });
});
