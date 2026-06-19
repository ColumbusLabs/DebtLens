import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const gitLabDocs = readFileSync("docs/ci-gitlab.md", "utf8");
const azureDocs = readFileSync("docs/ci-azure.md", "utf8");
const bitbucketDocs = readFileSync("docs/ci-bitbucket.md", "utf8");
const githubDocs = readFileSync("docs/ci-github.md", "utf8");
const quickstartDocs = readFileSync("docs/quickstart.md", "utf8");
const readme = readFileSync("README.md", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { files: string[] };

describe("provider CI docs", () => {
  it("documents local and GitHub quality gate preset adoption paths", () => {
    for (const docs of [readme, quickstartDocs, githubDocs]) {
      for (const preset of ["advisory", "new-code", "strict-new-code", "legacy-baseline"]) {
        assert.match(docs, new RegExp(`\\b${preset}\\b`));
      }
    }
    assert.match(quickstartDocs, /advisory[\s\S]*new-code[\s\S]*strict-new-code/);
    assert.match(quickstartDocs, /legacy-baseline[\s\S]*strict-new-code/);
    assert.match(githubDocs, /gate: advisory/);
    assert.match(githubDocs, /gate: new-code/);
    assert.match(githubDocs, /gate: legacy-baseline/);
    assert.match(githubDocs, /gate: strict-new-code/);
    assert.match(githubDocs, /does not pass `gate` to `write-baseline` mode/);
  });

  it("documents GitLab Code Quality baseline and new-code gates", () => {
    assert.match(gitLabDocs, /--format gitlab-codequality --output gl-code-quality-report\.json/);
    assert.match(gitLabDocs, /reports:\n\s+codequality: gl-code-quality-report\.json/);
    assert.match(gitLabDocs, /## New-code gate/);
    assert.match(gitLabDocs, /git fetch origin "\$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"/);
    assert.match(gitLabDocs, /--gate new-code --diff-base "origin\/\$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"/);
    assert.match(gitLabDocs, /## Legacy baseline gate/);
    assert.match(gitLabDocs, /--write-baseline debtlens-baseline\.json/);
    assert.match(gitLabDocs, /--gate legacy-baseline --baseline debtlens-baseline\.json/);
    assert.match(gitLabDocs, /--gate strict-new-code/);
  });

  it("documents Azure JSON artifacts plus native log issue annotations", () => {
    assert.match(azureDocs, /fetchDepth: 0/);
    assert.match(azureDocs, /refs such as `origin\/main` are available to git/);
    assert.match(azureDocs, /--gate new-code --diff-base origin\/main --format json --output debtlens-report\.json/);
    assert.match(azureDocs, /emit-azure-log-issues\.mjs debtlens-report\.json/);
    assert.match(azureDocs, /task\.logissue/);
    assert.match(azureDocs, /DEBTLENS_AZURE_ERROR_ON/);
    assert.match(azureDocs, /publish: debtlens-report\.json/);
    assert.match(azureDocs, /--gate advisory/);
    assert.match(azureDocs, /--gate legacy-baseline --baseline debtlens-baseline\.json/);
    assert.match(azureDocs, /--gate strict-new-code --diff-base origin\/main/);
  });

  it("documents Bitbucket Code Insights reports, annotations, and failure modes", () => {
    assert.match(bitbucketDocs, /clone:\n  depth: full/);
    assert.match(bitbucketDocs, /git fetch origin "\$BITBUCKET_PR_DESTINATION_BRANCH"/);
    assert.match(bitbucketDocs, /--gate new-code --diff-base "origin\/\$BITBUCKET_PR_DESTINATION_BRANCH" --format json --output debtlens-report\.json/);
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
    assert.match(bitbucketDocs, /--gate advisory/);
    assert.match(bitbucketDocs, /--gate legacy-baseline --baseline debtlens-baseline\.json/);
    assert.match(bitbucketDocs, /--gate strict-new-code --diff-base "origin\/\$BITBUCKET_PR_DESTINATION_BRANCH"/);
  });

  it("ships provider helper scripts in the npm package", () => {
    assert.ok(packageJson.files.includes("scripts/emit-azure-log-issues.mjs"));
    assert.ok(packageJson.files.includes("scripts/post-bitbucket-code-insights.mjs"));
  });
});
