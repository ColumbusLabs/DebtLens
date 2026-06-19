import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const actionYml = readFileSync("action.yml", "utf8");

describe("GitHub Action metadata", () => {
  it("exposes Wave 2 scan/reporting inputs", () => {
    for (const input of [
      "diff-base",
      "pack",
      "gate",
      "package",
      "profile",
      "cache",
      "cache-path",
      "parallel",
      "batch-size",
      "blame-age",
      "audit-suppressions",
      "fail-on-regression",
      "json-output",
      "upload-json-artifact",
      "previous-report",
      "comment-delta-only",
      "comment-max-findings",
      "comment-max-bytes",
      "comment-full-report-url",
      "comment-fail-on-error",
      "annotations",
      "annotations-max-count",
      "group-by",
      "sarif-compact",
      "sarif-category",
      "junit-fail-on",
      "markdown-heatmap",
    ]) {
      assert.match(actionYml, new RegExp(`\\n  ${input}:\\n`));
    }
  });

  it("renders reports from one canonical JSON scan and optionally uploads the artifact before replaying status", () => {
    assert.match(actionYml, /Output format \(terminal, json, markdown, pr-comment, sarif, html, junit, gitlab-codequality\)/);
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
    assert.match(actionYml, /DL_AUDIT_SUPPRESSIONS: \$\{\{ inputs\.audit-suppressions \}\}/);
    assert.match(actionYml, /args\+=\(--audit-suppressions\)/);
  });

  it("documents supported packs and bootstraps tagged release assets before source fallback", () => {
    assert.match(actionYml, /core, react, react-native, next, expo, node, python, python-web, vue, svelte, kotlin, compose, ai-assisted-maintainer, oss-maintainer/);
    assert.match(actionYml, /DL_ACTION_REF: \$\{\{ github\.action_ref \}\}/);
    assert.match(actionYml, /DL_ACTION_REPOSITORY: \$\{\{ github\.action_repository \}\}/);
    assert.match(actionYml, /scripts\/prepare-action-runtime\.sh/);
  });

  it("keeps public description aligned with shipped language support", () => {
    assert.match(actionYml, /TypeScript, JavaScript, Python, Vue\/Svelte SFC scripts, Kotlin, Jetpack Compose/);
    assert.doesNotMatch(actionYml, /TypeScript and React codebases/);
  });

  it("passes PR comment caps and fail-soft controls through to scripts", () => {
    assert.match(actionYml, /comment-max-bytes:\n    description:.*\n    default: "60000"/s);
    assert.match(actionYml, /DL_COMMENT_MAX_FINDINGS: \$\{\{ inputs\.comment-max-findings \}\}/);
    assert.match(actionYml, /DL_COMMENT_MAX_BYTES: \$\{\{ inputs\.comment-max-bytes \}\}/);
    assert.match(actionYml, /DEBTLENS_PR_COMMENT_MAX_FINDINGS="\$DL_COMMENT_MAX_FINDINGS"/);
    assert.match(actionYml, /DEBTLENS_PR_COMMENT_MAX_BYTES="\$DL_COMMENT_MAX_BYTES"/);
    assert.match(actionYml, /DEBTLENS_COMMENT_FAIL_ON_ERROR="\$DL_COMMENT_FAIL_ON_ERROR"/);
  });

  it("exposes scan metrics, gate status, and artifact paths as Action outputs", () => {
    for (const output of [
      "scan-status",
      "gate-status",
      "total-issues",
      "high-issues",
      "medium-issues",
      "low-issues",
      "info-issues",
      "top-rule",
      "top-rule-count",
      "json-path",
      "json-artifact-name",
      "report-path",
      "report-format",
    ]) {
      assert.match(actionYml, new RegExp(`\\n  ${output}:\\n[\\s\\S]*?value: \\$\\{\\{ steps\\.scan\\.outputs\\['${output}'\\] \\}\\}`));
    }
    assert.match(actionYml, /scripts\/export-action-outputs\.mjs/);
    assert.match(actionYml, /DEBTLENS_SCAN_STATUS="\$scan_status"/);
  });

  it("passes fail-on confidence into the step summary gate context", () => {
    assert.match(actionYml, /DL_FAIL_ON_CONFIDENCE: \$\{\{ inputs\.fail-on-confidence \}\}/);
    assert.match(actionYml, /DEBTLENS_FAIL_ON_CONFIDENCE="\$summary_fail_on_confidence"/);
  });

  it("passes named quality gate presets to normal scans only", () => {
    assert.match(actionYml, /gate:\n    description: Named quality-gate preset \(advisory, new-code, strict-new-code, legacy-baseline\)\./);
    assert.match(actionYml, /DL_GATE: \$\{\{ inputs\.gate \}\}/);
    assert.match(actionYml, /\[ -n "\$DL_GATE" \] && args\+=\(--gate "\$DL_GATE"\)/);
    assert.match(actionYml, /case "\$DL_GATE" in/);
    assert.match(actionYml, /new-code\)[\s\S]*summary_fail_on="high"/);
    assert.match(actionYml, /strict-new-code\)[\s\S]*summary_fail_on="medium"[\s\S]*summary_fail_on_confidence="0\.8"[\s\S]*summary_fail_on_regression="true"/);
    assert.match(actionYml, /legacy-baseline\)[\s\S]*summary_fail_on="high"[\s\S]*summary_fail_on_regression="true"/);
    assert.match(actionYml, /DEBTLENS_FAIL_ON="\$summary_fail_on"/);
    assert.match(actionYml, /DEBTLENS_FAIL_ON_REGRESSION="\$summary_fail_on_regression"/);

    const baselineWriteBlock = actionYml.slice(
      actionYml.indexOf('if [ -n "$DL_WRITE_BASELINE" ]; then'),
      actionYml.indexOf('internal_json="$RUNNER_TEMP/debtlens-report.json"'),
    );
    assert.doesNotMatch(baselineWriteBlock, /DL_GATE|--gate/);
  });

  it("can emit capped GitHub workflow command annotations", () => {
    assert.match(actionYml, /DL_ANNOTATIONS: \$\{\{ inputs\.annotations \}\}/);
    assert.match(actionYml, /DL_ANNOTATIONS_MAX_COUNT: \$\{\{ inputs\.annotations-max-count \}\}/);
    assert.match(actionYml, /scripts\/emit-github-annotations\.mjs/);
  });

  it("passes SARIF category through to rendered reports", () => {
    assert.match(actionYml, /sarif-category:\n    description: SARIF only - set runs\[\]\.automationDetails\.id/s);
    assert.match(actionYml, /DL_SARIF_CATEGORY: \$\{\{ inputs\.sarif-category \}\}/);
    assert.match(actionYml, /export DEBTLENS_SARIF_CATEGORY="\$DL_SARIF_CATEGORY"/);
  });

  it("passes JUnit failure threshold through to rendered reports", () => {
    assert.match(actionYml, /junit-fail-on:\n    description: JUnit only - severity threshold for failed testcases/s);
    assert.match(actionYml, /DL_JUNIT_FAIL_ON: \$\{\{ inputs\.junit-fail-on \}\}/);
    assert.match(actionYml, /export DEBTLENS_JUNIT_FAIL_ON="\$DL_JUNIT_FAIL_ON"/);
  });
});
