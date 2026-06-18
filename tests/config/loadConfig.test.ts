import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeDebtLensConfig } from "../../src/config/loadConfig.js";

describe("mergeDebtLensConfig", () => {
  it("union-merges include, exclude, and rules arrays without duplicates", () => {
    const merged = mergeDebtLensConfig(
      {
        include: ["src/**", "lib/**"],
        exclude: ["dist/**"],
        rules: ["todo-comment", "large-function"],
      },
      {
        include: ["lib/**", "apps/**"],
        exclude: ["dist/**", "coverage/**"],
        rules: ["large-function", "import-cycle"],
      },
    );

    assert.deepEqual(merged.include, ["src/**", "lib/**", "apps/**"]);
    assert.deepEqual(merged.exclude, ["dist/**", "coverage/**"]);
    assert.deepEqual(merged.rules, ["todo-comment", "large-function", "import-cycle"]);
  });

  it("omits empty include, exclude, and rules arrays after merge", () => {
    const merged = mergeDebtLensConfig({ minSeverity: "low" }, { pack: "core" });
    assert.equal(merged.include, undefined);
    assert.equal(merged.exclude, undefined);
    assert.equal(merged.rules, undefined);
  });
});
