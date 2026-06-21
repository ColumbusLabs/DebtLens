import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import {
  detectSourceLanguage,
  getLanguageDefinition,
  includeGlobsForLanguages,
  languagesForDetector,
  rewriteDefaultExcludesForLanguages,
} from "../../src/core/languages.js";
import type { Detector } from "../../src/core/types.js";

describe("language registry", () => {
  it("detects source languages from registered extensions", () => {
    assert.equal(detectSourceLanguage("src/app.tsx"), "tsjs");
    assert.equal(detectSourceLanguage("service/jobs.py"), "python");
    assert.equal(detectSourceLanguage("android/MainActivity.kt"), "kotlin");
    assert.equal(detectSourceLanguage("ios/InvoiceService.swift"), "swift");
    assert.equal(detectSourceLanguage("app/models/user.rb"), "ruby");
    assert.equal(detectSourceLanguage("android/build.gradle.kts"), "kotlin");
    assert.equal(detectSourceLanguage("src/App.vue"), "vue");
    assert.equal(detectSourceLanguage("src/routes/+page.svelte"), "svelte");
  });

  it("maps detectors without languages to the default TS/JS language", () => {
    const detector = {
      id: "custom-rule",
      name: "Custom rule",
      description: "Fixture detector.",
      defaultSeverity: "low",
      tags: [],
      detect: () => [],
    } satisfies Detector;

    assert.deepEqual(languagesForDetector(detector), ["tsjs"]);
    assert.deepEqual(languagesForDetector({ ...detector, languages: ["python"] }), ["python"]);
  });

  it("publishes include globs and exclude rewrites from language metadata", () => {
    assert.deepEqual(getLanguageDefinition("python").includeGlobs, ["**/*.py"]);
    assert.deepEqual(includeGlobsForLanguages(["python", "vue", "svelte", "kotlin", "swift", "ruby"]), ["**/*.py", "**/*.vue", "**/*.svelte", "**/*.{kt,kts}", "**/*.swift", "**/*.rb"]);
    assert.deepEqual(
      rewriteDefaultExcludesForLanguages(["kotlin"], defaultConfig.exclude).filter((pattern) => pattern.startsWith("android/")),
      ["android/**/*.{ts,tsx,js,jsx}"],
    );
  });
});
