import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");

describe("release workflow", () => {
  it("builds and uploads the npm package plus Action dist runtime", () => {
    assert.match(releaseWorkflow, /npm run test:all/);
    assert.match(releaseWorkflow, /npm run build/);
    assert.match(releaseWorkflow, /npm pack/);
    assert.match(releaseWorkflow, /npm ci --omit=dev --prefix \.release\/action/);
    assert.match(releaseWorkflow, /tar -C \.release\/action -czf debtlens-action-dist\.tgz \./);
    assert.match(releaseWorkflow, /name: debtlens-npm-package/);
    assert.match(releaseWorkflow, /name: debtlens-action-dist/);
    assert.match(releaseWorkflow, /softprops\/action-gh-release@v2/);
    assert.match(releaseWorkflow, /debtlens-action-dist\.tgz/);
    assert.match(releaseWorkflow, /scripts\/prepare-action-runtime\.sh/);
    assert.match(releaseWorkflow, /scripts\/render-scan-result\.mjs/);
  });
});
