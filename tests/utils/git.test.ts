import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  getChangedFiles,
  getFileChurn,
  getIgnoredFiles,
  getLineIntroducedDaysAgo,
  getRefSnapshot,
  getStagedFiles,
  isGitRepo,
} from "../../src/utils/git.js";

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function commit(cwd: string, message: string, date = "2026-01-01T00:00:00Z"): void {
  git(cwd, ["commit", "-m", message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
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
    commit(dir, "init");
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
    assert.equal(getLineIntroducedDaysAgo(plain, "src/file.ts", 1), null);
    assert.equal(getFileChurn(plain, ["src/file.ts"], { days: 7 }), null);
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

  it("reads scannable file contents at a ref", () => {
    const snapshot = getRefSnapshot(dir, "HEAD");
    assert.ok(snapshot);
    assert.ok(snapshot.files.some((file) => file.endsWith("src/committed.ts")));
    const committedPath = snapshot.files.find((file) => file.endsWith("src/committed.ts"));
    assert.equal(snapshot.contents?.[committedPath!], "export const a = 1;\n");
  });

  it("reports file churn over a day lookback and ignores files outside the repo", () => {
    const hot = join(dir, "src", "hot.ts");
    writeFileSync(hot, "export const hot = 1;\n");
    git(dir, ["add", "src/hot.ts"]);
    commit(dir, "add hot", "2026-01-02T00:00:00Z");

    writeFileSync(join(dir, "src", "committed.ts"), "export const a = 2;\nexport const b = 3;\n");
    git(dir, ["add", "src/committed.ts"]);
    commit(dir, "update committed", "2026-01-08T00:00:00Z");

    writeFileSync(hot, "export const hot = 1;\nexport const extra = 2;\n");
    git(dir, ["add", "src/hot.ts"]);
    commit(dir, "update hot", "2026-01-09T00:00:00Z");

    const outside = mkdtempSync(join(tmpdir(), "debtlens-outside-"));
    try {
      writeFileSync(join(outside, "outside.ts"), "export const outside = true;\n");

      const churn = getFileChurn(
        dir,
        [hot, join(dir, "src", "committed.ts"), join(outside, "outside.ts")],
        { days: 5, now: new Date("2026-01-10T00:00:00Z") },
      );

      assert.ok(churn);
      assert.equal(churn.window.days, 5);
      assert.equal(churn.window.since, "2026-01-05T00:00:00.000Z");
      assert.deepEqual(
        churn.files.map((file) => file.repositoryPath).sort(),
        ["src/committed.ts", "src/hot.ts"],
      );

      const committed = churn.files.find((file) => file.repositoryPath === "src/committed.ts");
      assert.ok(committed);
      assert.equal(committed.file, "src/committed.ts");
      assert.equal(committed.commits, 1);
      assert.equal(committed.additions, 2);
      assert.equal(committed.deletions, 1);
      assert.equal(committed.changedLines, 3);

      const hotMetric = churn.files.find((file) => file.repositoryPath === "src/hot.ts");
      assert.ok(hotMetric);
      assert.equal(hotMetric.file, "src/hot.ts");
      assert.equal(hotMetric.commits, 1);
      assert.equal(hotMetric.additions, 1);
      assert.equal(hotMetric.deletions, 0);
      assert.equal(hotMetric.changedLines, 1);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("reports file churn for an explicit git range", () => {
    const base = git(dir, ["rev-parse", "HEAD"]);
    const file = join(dir, "src", "committed.ts");

    writeFileSync(file, "export const a = 2;\n");
    git(dir, ["add", "src/committed.ts"]);
    commit(dir, "change committed", "2026-01-02T00:00:00Z");

    writeFileSync(file, "export const a = 2;\nexport const b = 3;\n");
    git(dir, ["add", "src/committed.ts"]);
    commit(dir, "expand committed", "2026-01-03T00:00:00Z");
    const head = git(dir, ["rev-parse", "HEAD"]);

    writeFileSync(join(dir, "src", "later.ts"), "export const later = true;\n");
    git(dir, ["add", "src/later.ts"]);
    commit(dir, "add later", "2026-01-04T00:00:00Z");

    const churn = getFileChurn(
      dir,
      [file, join(dir, "src", "later.ts")],
      { range: `${base}..${head}` },
    );

    assert.ok(churn);
    assert.equal(churn.window.range, `${base}..${head}`);

    const committed = churn.files.find((entry) => entry.repositoryPath === "src/committed.ts");
    assert.ok(committed);
    assert.equal(committed.file, "src/committed.ts");
    assert.equal(committed.commits, 2);
    assert.equal(committed.additions, 2);
    assert.equal(committed.deletions, 1);
    assert.equal(committed.changedLines, 3);

    const later = churn.files.find((entry) => entry.repositoryPath === "src/later.ts");
    assert.ok(later);
    assert.equal(later.commits, 0);
    assert.equal(later.changedLines, 0);
  });

  it("throws a clear error for an unknown churn range", () => {
    assert.throws(
      () => getFileChurn(dir, [join(dir, "src", "committed.ts")], { range: "HEAD..no-such-ref" }),
      /Could not resolve git churn range "HEAD\.\.no-such-ref"/,
    );
  });

  it("returns zero churn for a git repo with no commits", () => {
    const empty = mkdtempSync(join(tmpdir(), "debtlens-empty-git-"));
    try {
      git(empty, ["init"]);
      mkdirSync(join(empty, "src"));
      writeFileSync(join(empty, "src", "new.ts"), "export const fresh = true;\n");

      const churn = getFileChurn(empty, [join(empty, "src", "new.ts")], {
        days: 7,
        now: new Date("2026-01-10T00:00:00Z"),
      });

      assert.ok(churn);
      assert.equal(churn.files.length, 1);
      assert.deepEqual(churn.files[0], {
        file: "src/new.ts",
        repositoryPath: "src/new.ts",
        commits: 0,
        additions: 0,
        deletions: 0,
        changedLines: 0,
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous churn windows", () => {
    assert.throws(
      () => getFileChurn(dir, [join(dir, "src", "committed.ts")], {
        days: 7,
        range: "HEAD",
      }),
      /either git churn days or git churn range/,
    );
  });

  it("reports whole-day blame age for committed lines", () => {
    const age = getLineIntroducedDaysAgo(dir, "src/committed.ts", 1);

    assert.equal(typeof age, "number");
    assert.ok((age ?? -1) >= 0);
  });

  it("reports blame age when cwd is inside a work tree subdirectory", () => {
    const age = getLineIntroducedDaysAgo(join(dir, "src"), join(dir, "src", "committed.ts"), 1);

    assert.equal(typeof age, "number");
    assert.ok((age ?? -1) >= 0);
  });
});
