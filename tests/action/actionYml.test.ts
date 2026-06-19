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
      "cache",
      "cache-path",
      "parallel",
      "batch-size",
      "blame-age",
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

  it("renders reports from one canonical JSON scan and optionally uploads the artifact before replaying status", () => {
    assert.match(actionYml, /--format json --output "\$internal_json"/);
    assert.match(actionYml, /scripts\/render-scan-result\.mjs/);
    assert.match(actionYml, /upload-json-artifact:\n    description:.*\n    default: "false"/s);
    assert.match(actionYml, /inputs\.upload-json-artifact == 'true'/);
    assert.match(actionYml, /actions\/upload-artifact@v4/);
    assert.match(actionYml, /steps\.scan\.outputs\['scan-status'\]/);
  });

  it("passes performance controls through to the scanner", () => {
    assert.match(actionYml, /DL_CACHE: \$\{\{ inputs\.cache \}\}/);
    assert.match(actionYml, /DL_CACHE_PATH: \$\{\{ inputs\.cache-path \}\}/);
    assert.match(actionYml, /args\+=\(--cache "\$DL_CACHE_PATH"\)/);
    assert.match(actionYml, /args\+=\(--cache\)/);
    assert.match(actionYml, /args\+=\(--parallel\)/);
    assert.match(actionYml, /args\+=\(--batch-size "\$DL_BATCH_SIZE"\)/);
    assert.match(actionYml, /DL_BLAME_AGE: \$\{\{ inputs\.blame-age \}\}/);
    assert.match(actionYml, /args\+=\(--blame-age\)/);
  });

  it("documents supported packs and bootstraps tagged release assets before source fallback", () => {
    assert.match(actionYml, /core, react, react-native, next, expo, node, python, ai-assisted-maintainer, oss-maintainer/);
    assert.match(actionYml, /DL_ACTION_REF: \$\{\{ github\.action_ref \}\}/);
    assert.match(actionYml, /DL_ACTION_REPOSITORY: \$\{\{ github\.action_repository \}\}/);
    assert.match(actionYml, /scripts\/prepare-action-runtime\.sh/);
  });

  it("keeps public description aligned with shipped language support", () => {
    assert.match(actionYml, /TypeScript, JavaScript, Python/);
    assert.doesNotMatch(actionYml, /TypeScript and React codebases/);
  });
});
