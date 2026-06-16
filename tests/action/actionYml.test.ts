import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const actionYml = readFileSync("action.yml", "utf8");

describe("GitHub Action metadata", () => {
  it("exposes Wave 2 scan/reporting inputs", () => {
    for (const input of [
      "diff-base",
      "pack",
      "package",
      "profile",
      "fail-on-regression",
      "json-output",
      "upload-json-artifact",
      "previous-report",
      "comment-delta-only",
      "group-by",
      "sarif-compact",
      "markdown-heatmap",
    ]) {
      assert.match(actionYml, new RegExp(`\\n  ${input}:\\n`));
    }
  });

  it("renders reports from one canonical JSON scan and uploads the artifact before replaying status", () => {
    assert.match(actionYml, /--format json --output "\$internal_json"/);
    assert.match(actionYml, /scripts\/render-scan-result\.mjs/);
    assert.match(actionYml, /actions\/upload-artifact@v4/);
    assert.match(actionYml, /steps\.scan\.outputs\['scan-status'\]/);
  });
});
