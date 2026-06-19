import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const gitLabDocs = readFileSync("docs/ci-gitlab.md", "utf8");
const azureDocs = readFileSync("docs/ci-azure.md", "utf8");
const bitbucketDocs = readFileSync("docs/ci-bitbucket.md", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { files: string[] };

describe("provider CI docs", () => {
  it("documents GitLab Code Quality baseline and new-code gates", () => {
    assert.match(gitLabDocs, /--format gitlab-codequality --output gl-code-quality-report\.json/);
    assert.match(gitLabDocs, /reports:\n\s+codequality: gl-code-quality-report\.json/);
    assert.match(gitLabDocs, /## New-code gate/);
    assert.match(gitLabDocs, /git fetch origin "\$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"/);
    assert.match(gitLabDocs, /--diff-base "origin\/\$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"/);
    assert.match(gitLabDocs, /## Legacy baseline gate/);
    assert.match(gitLabDocs, /--write-baseline debtlens-baseline\.json/);
    assert.match(gitLabDocs, /--baseline debtlens-baseline\.json/);
  });

  it("documents Azure JSON artifacts plus native log issue annotations", () => {
    assert.match(azureDocs, /--format json --output debtlens-report\.json --fail-on high/);
    assert.match(azureDocs, /emit-azure-log-issues\.mjs debtlens-report\.json/);
    assert.match(azureDocs, /task\.logissue/);
    assert.match(azureDocs, /DEBTLENS_AZURE_ERROR_ON/);
    assert.match(azureDocs, /publish: debtlens-report\.json/);
  });

  it("documents Bitbucket Code Insights reports, annotations, and failure modes", () => {
    assert.match(bitbucketDocs, /--format json --output debtlens-report\.json --fail-on high/);
    assert.match(bitbucketDocs, /post-bitbucket-code-insights\.mjs debtlens-report\.json/);
    assert.match(bitbucketDocs, /status=\$\?/);
    assert.match(bitbucketDocs, /post_status=\$\?/);
    assert.match(bitbucketDocs, /exit "\$post_status"/);
    assert.match(bitbucketDocs, /exit \$status/);
    assert.match(bitbucketDocs, /BITBUCKET_USERNAME/);
    assert.match(bitbucketDocs, /BITBUCKET_API_TOKEN/);
    assert.match(bitbucketDocs, /DEBTLENS_BITBUCKET_FAIL_ON_ERROR/);
    assert.match(bitbucketDocs, /forked or restricted pull request/);
    assert.match(bitbucketDocs, /up to 100\s+annotations per request and 1000 annotations per report/);
    assert.match(bitbucketDocs, /artifacts:\n\s+- debtlens-report\.json/);
  });

  it("ships provider helper scripts in the npm package", () => {
    assert.ok(packageJson.files.includes("scripts/emit-azure-log-issues.mjs"));
    assert.ok(packageJson.files.includes("scripts/post-bitbucket-code-insights.mjs"));
  });
});
