import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { describe, it } from "node:test";
import { runTriage } from "../../src/cli/triage.js";

describe("debtlens triage", () => {
  it("starts on a fresh repo without an existing baseline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-triage-fresh-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "// TODO triage me\nexport const value = 1;\n");

      const counts = await runTriage({
        target: ".",
        cwd: dir,
        dryRun: true,
        cliOptions: { rules: "todo-comment" },
        input: Readable.from(["q\n"]),
        output: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
      });

      assert.deepEqual(counts, { kept: 0, baselined: 0, suppressed: 0, skipped: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const [label, answers, expected] of [
    ["quit", ["q"], { kept: 0, baselined: 0, suppressed: 0, skipped: 0 }],
    ["keep", ["k"], { kept: 1, baselined: 0, suppressed: 0, skipped: 0 }],
  ] as const) {
    it(`does not create a baseline file after a non-dry-run ${label} flow`, async () => {
      const dir = mkdtempSync(join(tmpdir(), `debtlens-triage-${label}-`));
      try {
        mkdirSync(join(dir, "src"));
        writeFileSync(join(dir, "src", "app.ts"), "// TODO triage me\nexport const value = 1;\n");
        const baselinePath = join(dir, "debtlens-baseline.json");
        const queue = [...answers];
        const counts = await runTriage({
          target: ".",
          cwd: dir,
          baselinePath,
          cliOptions: { rules: "todo-comment" },
          output: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
          ask: async () => queue.shift() ?? "q",
        });

        assert.deepEqual(counts, expected);
        assert.equal(existsSync(baselinePath), false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("baselines a finding when requested", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-triage-baseline-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "// TODO triage me\nexport const value = 1;\n");
      const baselinePath = join(dir, "debtlens-baseline.json");

      const counts = await runTriage({
        target: ".",
        cwd: dir,
        baselinePath,
        cliOptions: { rules: "todo-comment" },
        input: Readable.from(["b\n", "q\n"]),
        output: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
      });

      assert.deepEqual(counts, { kept: 0, baselined: 1, suppressed: 0, skipped: 0 });
      const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
        fingerprints: Record<string, number>;
        summary: { totalIssues: number; byRule: Record<string, number> };
        issues: Record<string, { ruleId: string; count: number }>;
      };
      assert.equal(Object.keys(baseline.fingerprints).length, 1);
      assert.equal(baseline.summary.totalIssues, 1);
      assert.equal(baseline.summary.byRule["todo-comment"], 1);
      assert.equal(Object.values(baseline.issues)[0]?.ruleId, "todo-comment");
      assert.equal(Object.values(baseline.issues)[0]?.count, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not re-present or inflate a finding already in the loaded baseline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-triage-rerun-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "// TODO triage me\nexport const value = 1;\n");
      const baselinePath = join(dir, "debtlens-baseline.json");
      await runTriage({
        target: ".",
        cwd: dir,
        baselinePath,
        cliOptions: { rules: "todo-comment" },
        output: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
        ask: async () => "b",
      });
      const before = readFileSync(baselinePath, "utf8");
      let prompts = 0;
      const output: string[] = [];

      const counts = await runTriage({
        target: ".",
        cwd: dir,
        baselinePath,
        cliOptions: { rules: "todo-comment" },
        output: new Writable({ write(chunk, _encoding, callback) { output.push(String(chunk)); callback(); } }),
        ask: async () => { prompts += 1; return "b"; },
      });

      assert.deepEqual(counts, { kept: 0, baselined: 0, suppressed: 0, skipped: 0 });
      assert.equal(prompts, 0);
      assert.equal(output.join(""), "");
      assert.equal(readFileSync(baselinePath, "utf8"), before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prompts for a suppression reason", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-triage-suppress-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "// TODO triage me\nexport const value = 1;\n");
      const output: string[] = [];
      const answers = ["s", "tracked in PROJ-42"];
      const out = new Writable({
        write(chunk, _encoding, callback) {
          output.push(String(chunk));
          callback();
        },
      });

      const counts = await runTriage({
        target: ".",
        cwd: dir,
        dryRun: true,
        cliOptions: { rules: "todo-comment" },
        output: out,
        ask: async () => answers.shift() ?? "",
      });

      assert.deepEqual(counts, { kept: 0, baselined: 0, suppressed: 1, skipped: 0 });
      assert.match(output.join(""), /debtlens-disable-next-line todo-comment -- tracked in PROJ-42/);
      assert.doesNotMatch(readFileSync(join(dir, "src", "app.ts"), "utf8"), /debtlens-disable-next-line/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes an inline suppression that hides the finding", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-triage-write-suppress-"));
    try {
      mkdirSync(join(dir, "src"));
      const sourcePath = join(dir, "src", "app.ts");
      writeFileSync(sourcePath, "// TODO triage me\nexport const value = 1;\n");
      const answers = ["s", "tracked in PROJ-42"];

      const counts = await runTriage({
        target: ".",
        cwd: dir,
        cliOptions: { rules: "todo-comment" },
        output: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
        ask: async () => answers.shift() ?? "q",
      });

      assert.equal(counts.suppressed, 1);
      assert.equal(existsSync(join(dir, "debtlens-baseline.json")), false);
      assert.match(readFileSync(sourcePath, "utf8"), /^\/\/ debtlens-disable-next-line todo-comment -- tracked in PROJ-42\n\/\/ TODO/);

      const verificationAnswers = ["q"];
      const verificationOutput: string[] = [];
      const verified = await runTriage({
        target: ".",
        cwd: dir,
        dryRun: true,
        cliOptions: { rules: "todo-comment" },
        output: new Writable({
          write(chunk, _encoding, callback) {
            verificationOutput.push(String(chunk));
            callback();
          },
        }),
        ask: async () => verificationAnswers.shift() ?? "q",
      });
      assert.deepEqual(verified, { kept: 0, baselined: 0, suppressed: 0, skipped: 0 });
      assert.equal(verificationOutput.join(""), "");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints an issue snippet and continues after a batch-by-rule action", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-triage-batch-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), [
        "// TODO first",
        "// TODO second",
        "try { run(); } catch (error) {}",
        "",
      ].join("\n"));
      const output: string[] = [];
      const answers = ["B", "k", "o"];

      const counts = await runTriage({
        target: ".",
        cwd: dir,
        dryRun: true,
        cliOptions: { rules: "todo-comment,empty-catch" },
        output: new Writable({
          write(chunk, _encoding, callback) {
            output.push(String(chunk));
            callback();
          },
        }),
        ask: async () => answers.shift() ?? "q",
      });

      assert.deepEqual(counts, { kept: 2, baselined: 0, suppressed: 0, skipped: 0 });
      assert.match(output.join(""), /Issue creation snippet:/);
      assert.match(output.join(""), /empty-catch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
