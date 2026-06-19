import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

describe("debtlens explain", () => {
  it("prints rule metadata and default thresholds", () => {
    const result = runCli(["explain", "prop-drilling"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Prop drilling \[prop-drilling\]/);
    assert.match(result.stdout, /Default severity: /);
    assert.match(result.stdout, /prop-drilling\.maxForwardedProps: 4/);
  });

  it("includes false-positive guidance from docs/rules.md", () => {
    const result = runCli(["explain", "large-component"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /When this is a false positive/);
    assert.match(result.stdout, /large-component\.maxLines: 250/);
  });

  it("includes nested Vue and Svelte rule guidance from docs/rules.md", () => {
    const vue = runCli(["explain", "vue-large-script"]);
    const svelte = runCli(["explain", "svelte-large-script"]);

    assert.equal(vue.status, 0);
    assert.match(vue.stdout, /When this is a false positive/);
    assert.match(vue.stdout, /vue-large-script\.maxFunctionLines: 80/);
    assert.match(vue.stdout, /script-specific size or/);
    assert.doesNotMatch(vue.stdout, /svelte-todo-comment/);

    assert.equal(svelte.status, 0);
    assert.match(svelte.stdout, /For SvelteKit/);
    assert.match(svelte.stdout, /svelte-large-script\.maxFunctionLines: 80/);
    assert.doesNotMatch(svelte.stdout, /svelte-duplicate-logic/);
  });

  it("exits with a did-you-mean error for unknown rule ids", () => {
    const result = runCli(["explain", "todo-comments"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown DebtLens rule "todo-comments"/);
    assert.match(result.stderr, /Did you mean "todo-comment"\?/);
    assert.match(result.stderr, /debtlens rules/);
  });

  it("exits without a suggestion when nothing is close", () => {
    const result = runCli(["explain", "zzzz"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown DebtLens rule "zzzz"/);
    assert.doesNotMatch(result.stderr, /Did you mean/);
  });
});

describe("debtlens scan unknown rules", () => {
  it("suggests the closest rule id for --rules typos", () => {
    const result = runCli(["scan", "examples/react", "--rules", "todo-comments"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown DebtLens rule\(s\): todo-comments \(did you mean "todo-comment"\?\)/);
  });
});
