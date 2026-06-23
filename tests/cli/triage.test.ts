import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
});
