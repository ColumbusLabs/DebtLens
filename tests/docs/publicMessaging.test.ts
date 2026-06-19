import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

describe("public capability messaging", () => {
  it("keeps package, README, Action, and roadmap aligned on shipped languages", () => {
    const packageJson = JSON.parse(read("package.json")) as { description: string; keywords: string[] };
    const readme = read("README.md");
    const actionYml = read("action.yml");
    const cliIndex = read("src/cli/index.ts");
    const roadmap = read("ROADMAP.md");

    assert.match(packageJson.description, /TypeScript, JavaScript, Python, and Kotlin/);
    assert.ok(packageJson.keywords.includes("python"));
    assert.ok(packageJson.keywords.includes("kotlin"));
    assert.match(readme, /TypeScript, JavaScript, Python, and Kotlin/);
    assert.match(actionYml, /TypeScript, JavaScript, Python, Kotlin/);
    assert.match(cliIndex, /TypeScript, JavaScript, Python, Kotlin/);
    assert.match(roadmap, /TypeScript, JavaScript, Python, and Kotlin today/);
  });

  it("guards against stale TS-only or unshipped-plugin claims", () => {
    const publicDocs = [
      "README.md",
      "ROADMAP.md",
      "docs/architecture.md",
      "docs/examples.md",
      "docs/language-pack-rfc.md",
      "docs/pack-chooser.md",
      "docs/quickstart.md",
      "docs/rules.md",
      "docs/rule-packs.md",
      "docs/when-not-to-use.md",
      "docs/next-phase-plan.md",
      "docs/plugin-api-rfc.md",
      "src/cli/index.ts",
      "package.json",
      "action.yml",
    ].map(read).join("\n");

    assert.doesNotMatch(publicDocs, /TypeScript and JavaScript today/);
    assert.doesNotMatch(publicDocs, /mostly non-TS\/JS code/);
    assert.doesNotMatch(publicDocs, /will not understand Python/);
    assert.doesNotMatch(publicDocs, /React rule pack is the first supported target/);
    assert.doesNotMatch(publicDocs, /Plugin API can come later/);
    assert.doesNotMatch(publicDocs, /RFC . not implemented yet/);
    assert.doesNotMatch(publicDocs, /Today all detectors are hardcoded/);
    assert.doesNotMatch(publicDocs, /TypeScript and React codebases/);
    assert.doesNotMatch(publicDocs, /Kotlin.*future/i);
    assert.doesNotMatch(publicDocs, /unsupported.*Kotlin/i);
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
