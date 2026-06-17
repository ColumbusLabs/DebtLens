import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { configDriftDetector } from "../../src/detectors/configDrift.js";
import { runDetector } from "../helpers/runDetector.js";

describe("config-drift detector", () => {
  it("flags conflicting package scripts and tsconfig compiler options", async () => {
    const issues = await runDetector(configDriftDetector, {
      "packages/app/package.json": JSON.stringify({ scripts: { build: "vite build" } }),
      "packages/web/package.json": JSON.stringify({ scripts: { build: "next build" } }),
      "packages/app/tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
      "packages/web/tsconfig.json": JSON.stringify({ compilerOptions: { strict: false } }),
    });

    assert.equal(issues.length, 2);
    assert.ok(issues.some((issue) => issue.message.includes("scripts.build")));
    assert.ok(issues.some((issue) => issue.message.includes("compilerOptions.strict")));
  });

  it("does not execute or parse JS config files", async () => {
    const issues = await runDetector(configDriftDetector, {
      "eslint.config.js": "throw new Error('should not execute');\n",
      "packages/app/package.json": JSON.stringify({ scripts: { build: "vite build" } }),
      "packages/web/package.json": JSON.stringify({ scripts: { build: "vite build" } }),
    });

    assert.equal(issues.length, 0);
  });

  it("parses common tsconfig JSONC with comments and trailing commas", async () => {
    const issues = await runDetector(configDriftDetector, {
      "packages/app/tsconfig.json": `{
        // app package is strict
        "compilerOptions": {
          "strict": true,
        },
      }`,
      "packages/web/tsconfig.json": `{
        "compilerOptions": {
          "strict": false,
        },
      }`,
    });

    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /compilerOptions\.strict/);
  });
});
