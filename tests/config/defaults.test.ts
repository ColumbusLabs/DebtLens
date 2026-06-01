import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";

describe("default config", () => {
  it("excludes test and mock files by default", () => {
    for (const pattern of [
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/__tests__/**",
      "**/__mocks__/**",
    ]) {
      assert.ok(defaultConfig.exclude.includes(pattern), `missing exclude: ${pattern}`);
    }
  });
});
