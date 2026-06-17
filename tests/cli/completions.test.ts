import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

function runCompletions(shell: string) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, "completions", shell], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

describe("debtlens completions", () => {
  it("prints bash completions with commands, rules, packs, severities, and formats", () => {
    const result = runCompletions("bash");

    assert.equal(result.status, 0);
    assert.match(result.stdout, /complete -F _debtlens_complete debtlens/);
    assert.match(result.stdout, /scan doctor watch packs rules explain/);
    assert.match(result.stdout, /adopt mcp completions/);
    assert.match(result.stdout, /prop-drilling/);
    assert.match(result.stdout, /react-native/);
    assert.match(result.stdout, /markdown/);
    assert.match(result.stdout, /high/);
  });

  it("prints zsh and fish completions", () => {
    const zsh = runCompletions("zsh");
    const fish = runCompletions("fish");

    assert.equal(zsh.status, 0);
    assert.match(zsh.stdout, /#compdef debtlens/);
    assert.match(zsh.stdout, /--pack\[rule pack\]/);
    assert.match(zsh.stdout, /'--package' \\/);
    assert.match(zsh.stdout, /'--threshold' \\/);
    assert.equal(fish.status, 0);
    assert.match(fish.stdout, /complete -c debtlens/);
    assert.match(fish.stdout, /-l format -a "terminal json markdown pr-comment sarif html junit"/);
  });

  it("rejects unknown shells", () => {
    const result = runCompletions("powershell");

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Expected bash, zsh, or fish/);
  });
});
