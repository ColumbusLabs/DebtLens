import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getChangedFiles, getIgnoredFiles, getStagedFiles, isGitRepo } from "../../src/utils/git.js";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("git changed-files", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "debtlens-git-"));
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "t@t.t"]);
    git(dir, ["config", "user.name", "t"]);
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "committed.ts"), "export const a = 1;\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "init"]);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects a git work tree", () => {
    assert.equal(isGitRepo(dir), true);
    assert.equal(isGitRepo(tmpdir()), false);
  });

  it("returns null when not a git repo", () => {
    const plain = mkdtempSync(join(tmpdir(), "debtlens-plain-"));
    assert.equal(getChangedFiles(plain), null);
    assert.equal(getIgnoredFiles(plain, []), null);
    assert.equal(getStagedFiles(plain), null);
    rmSync(plain, { recursive: true, force: true });
  });

  it("reports ignored files from gitignore rules", () => {
    writeFileSync(join(dir, ".gitignore"), "src/ignored.ts\n");
    writeFileSync(join(dir, "src", "ignored.ts"), "export const ignored = 1;\n");
    writeFileSync(join(dir, "src", "kept.ts"), "export const kept = 1;\n");

    const ignored = getIgnoredFiles(dir, [
      join(dir, "src", "ignored.ts"),
      join(dir, "src", "kept.ts"),
    ]);

    assert.ok([...(ignored ?? [])].some((file) => file.endsWith("src/ignored.ts")));
    assert.ok(![...(ignored ?? [])].some((file) => file.endsWith("src/kept.ts")));
  });

  it("reports new untracked files and ignores committed unchanged ones", () => {
    writeFileSync(join(dir, "src", "newfile.ts"), "export const b = 2;\n");
    const changed = getChangedFiles(dir);
    assert.ok(changed);
    assert.ok(changed.files.some((f) => f.endsWith("src/newfile.ts")));
    assert.ok(!changed.files.some((f) => f.endsWith("src/committed.ts")));
  });

  it("reports modified tracked files", () => {
    writeFileSync(join(dir, "src", "committed.ts"), "export const a = 99;\n");
    const changed = getChangedFiles(dir);
    assert.ok(changed?.files.some((f) => f.endsWith("src/committed.ts")));
  });

  it("throws a clear error for an unknown base ref", () => {
    assert.throws(() => getChangedFiles(dir, "no-such-ref"), /Could not diff against base ref/);
  });

  it("reports staged files and ignores unstaged-only files", () => {
    writeFileSync(join(dir, "src", "staged.ts"), "export const staged = 1;\n");
    writeFileSync(join(dir, "src", "unstaged.ts"), "export const unstaged = 1;\n");
    git(dir, ["add", "src/staged.ts"]);

    const staged = getStagedFiles(dir);

    assert.ok(staged?.files.some((f) => f.endsWith("src/staged.ts")));
    assert.ok(!staged?.files.some((f) => f.endsWith("src/unstaged.ts")));
  });

  it("returns staged blob contents instead of working-tree contents", () => {
    const file = join(dir, "src", "committed.ts");
    writeFileSync(file, "export const staged = 2;\n");
    git(dir, ["add", "src/committed.ts"]);
    writeFileSync(file, "export const staged = 2;\n// TODO unstaged only\n");

    const staged = getStagedFiles(dir);
    const stagedPath = staged?.files.find((f) => f.endsWith("src/committed.ts"));

    assert.ok(stagedPath);
    assert.equal(staged?.contents?.[stagedPath], "export const staged = 2;\n");
  });
});
