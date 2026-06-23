import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
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

  it("scopes filesystem config discovery to config-drift.maxConfigFiles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-config-drift-scope-"));
    try {
      for (let index = 0; index < 4; index += 1) {
        const packageDir = join(dir, `packages/pkg-${index}`);
        mkdirSync(packageDir, { recursive: true });
        writeFileSync(join(packageDir, "package.json"), JSON.stringify({
          scripts: { build: index % 2 === 0 ? "vite build" : "next build" },
        }), "utf8");
      }

      const issues = await runDetector(configDriftDetector, {}, {
        target: dir,
        thresholds: { "config-drift.maxConfigFiles": 2 },
      });

      assert.equal(issues.length, 1);
      assert.match(issues[0]?.message ?? "", /scripts\.build/);
      assert.equal(issues[0]?.evidence?.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores nested dependency configs during filesystem discovery", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-config-drift-deps-"));
    try {
      mkdirSync(join(dir, "packages", "app"), { recursive: true });
      mkdirSync(join(dir, "apps", "mobile", "node_modules", "expo-splash-screen", "plugin"), { recursive: true });
      writeFileSync(join(dir, "packages", "app", "tsconfig.json"), JSON.stringify({
        compilerOptions: { strict: true },
      }), "utf8");
      writeFileSync(join(dir, "apps", "mobile", "node_modules", "expo-splash-screen", "plugin", "tsconfig.json"), JSON.stringify({
        compilerOptions: { strict: false },
      }), "utf8");

      const issues = await runDetector(configDriftDetector, {}, {
        target: dir,
        exclude: defaultConfig.exclude,
      });

      assert.equal(issues.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("anchors changed-mode drift to changed config files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-config-drift-changed-"));
    try {
      mkdirSync(join(dir, "packages", "app"), { recursive: true });
      mkdirSync(join(dir, "packages", "web"), { recursive: true });
      mkdirSync(join(dir, "packages", "legacy"), { recursive: true });
      writeFileSync(join(dir, "packages", "app", "package.json"), JSON.stringify({
        scripts: { build: "vite build", test: "vitest" },
      }), "utf8");
      writeFileSync(join(dir, "packages", "web", "package.json"), JSON.stringify({
        scripts: { build: "next build", test: "vitest" },
      }), "utf8");
      writeFileSync(join(dir, "packages", "legacy", "package.json"), JSON.stringify({
        scripts: { build: "next build", test: "vitest" },
      }), "utf8");

      const issues = await runDetector(configDriftDetector, {}, {
        target: dir,
        changedFiles: [join(dir, "packages", "app", "package.json")],
      });

      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.file, "packages/app/package.json");
      assert.match(issues[0]?.message ?? "", /scripts\.build/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not report global config drift when changed mode does not touch config files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-config-drift-unchanged-"));
    try {
      mkdirSync(join(dir, "packages", "app"), { recursive: true });
      mkdirSync(join(dir, "packages", "web"), { recursive: true });
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "packages", "app", "package.json"), JSON.stringify({
        scripts: { build: "vite build" },
      }), "utf8");
      writeFileSync(join(dir, "packages", "web", "package.json"), JSON.stringify({
        scripts: { build: "next build" },
      }), "utf8");
      writeFileSync(join(dir, "src", "app.ts"), "export const app = true;\n", "utf8");

      const issues = await runDetector(configDriftDetector, {}, {
        target: dir,
        changedFiles: [join(dir, "src", "app.ts")],
      });

      assert.equal(issues.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
