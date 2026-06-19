import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

describe("public capability messaging", () => {
  it("keeps package, README, Action, and roadmap aligned on shipped languages", () => {
    const packageJson = JSON.parse(read("package.json")) as { description: string; keywords: string[] };
    const readme = read("README.md");
    const actionYml = read("action.yml");
    const roadmap = read("ROADMAP.md");

    assert.match(packageJson.description, /TypeScript, JavaScript, and Python/);
    assert.ok(packageJson.keywords.includes("python"));
    assert.match(readme, /TypeScript, JavaScript, and Python/);
    assert.match(actionYml, /TypeScript, JavaScript, Python/);
    assert.match(roadmap, /TypeScript, JavaScript, and Python today/);
  });

  it("guards against stale TS-only or unshipped-plugin claims", () => {
    const publicDocs = [
      "README.md",
      "ROADMAP.md",
      "docs/architecture.md",
      "docs/rule-packs.md",
      "docs/when-not-to-use.md",
      "docs/next-phase-plan.md",
      "package.json",
      "action.yml",
    ].map(read).join("\n");

    assert.doesNotMatch(publicDocs, /TypeScript and JavaScript today/);
    assert.doesNotMatch(publicDocs, /mostly non-TS\/JS code/);
    assert.doesNotMatch(publicDocs, /will not understand Python/);
    assert.doesNotMatch(publicDocs, /React rule pack is the first supported target/);
    assert.doesNotMatch(publicDocs, /Plugin API can come later/);
    assert.doesNotMatch(publicDocs, /RFC . not implemented yet/);
  });

  it("links the first-run adoption docs from the README", () => {
    const readme = read("README.md");

    for (const target of [
      "docs/quickstart.md",
      "docs/pack-chooser.md",
      "docs/examples.md",
      "docs/report-gallery.md",
      "docs/false-positives.md",
    ]) {
      assert.match(readme, new RegExp(target.replace(".", "\\.")));
    }
  });
});
