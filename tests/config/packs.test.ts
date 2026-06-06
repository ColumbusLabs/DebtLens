import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeConfig } from "../../src/config/mergeConfig.js";
import { getRulePack, listRulePacks } from "../../src/config/packs.js";

describe("rule packs", () => {
  it("lists built-in packs with expected rule counts", () => {
    const packs = listRulePacks();
    assert.equal(packs.length, 4);
    assert.equal(getRulePack("core").rules.length, 4);
    assert.equal(getRulePack("react").rules.length, 8);
    assert.deepEqual(getRulePack("react-native").rules, getRulePack("react").rules);
    assert.deepEqual(getRulePack("next").rules, getRulePack("react").rules);
  });

  it("throws for unknown pack ids", () => {
    assert.throws(() => getRulePack("vue"), /Unknown rule pack "vue"/);
  });

  it("applies pack rules when no explicit rules are configured", () => {
    const options = mergeConfig(".", { pack: "core" }, { cwd: process.cwd() });
    assert.equal(options.pack, "core");
    assert.deepEqual(options.rules, getRulePack("core").rules);
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
