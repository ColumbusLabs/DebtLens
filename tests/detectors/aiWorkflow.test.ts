import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { mergeConfig } from "../../src/config/mergeConfig.js";
import { getRulePack } from "../../src/config/packs.js";
import {
  extractInstructionBlocks,
  instructionContradictionDetector,
  instructionDuplicationDetector,
  INSTRUCTION_FILE_GLOBS,
  isInstructionFile,
  normalizeInstructionBlock,
} from "../../src/detectors/aiWorkflow/index.js";
import { runDetector } from "../helpers/runDetector.js";

describe("ai workflow instruction parsing", () => {
  it("recognizes supported instruction file paths", () => {
    assert.equal(isInstructionFile("AGENTS.md"), true);
    assert.equal(isInstructionFile(".github/copilot-instructions.md"), true);
    assert.equal(isInstructionFile(".cursor/rules/testing.mdc"), true);
    assert.equal(isInstructionFile("src/app.ts"), false);
  });

  it("normalizes and extracts substantive instruction blocks", () => {
    const blocks = extractInstructionBlocks(`## Testing

Always run the full test suite before committing changes.

## Notes

Short.
`);
    assert.equal(blocks.length, 1);
    assert.equal(
      normalizeInstructionBlock("  - Always   run tests "),
      "always run tests",
    );
    assert.match(blocks[0]?.normalized ?? "", /always run the full test suite/);
  });
});

describe("ai-instruction-duplication detector", () => {
  it("flags the same normalized block across multiple instruction files", async () => {
    const shared = "Always run the full test suite before committing changes.";
    const issues = await runDetector(instructionDuplicationDetector, {
      "AGENTS.md": `## Testing\n\n${shared}`,
      "CLAUDE.md": `## Testing\n\n${shared}`,
    }, { language: "tsjs" });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "ai-instruction-duplication");
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("AGENTS.md")));
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("CLAUDE.md")));
  });

  it("does not flag complementary instructions in different files", async () => {
    const issues = await runDetector(instructionDuplicationDetector, {
      "AGENTS.md": "## Unit testing\n\nRun unit tests for all application code changes.",
      "CLAUDE.md": "## Integration testing\n\nRun integration tests when API contracts change.",
    }, { language: "tsjs" });

    assert.equal(issues.length, 0);
  });
});

describe("ai-instruction-contradiction detector", () => {
  it("flags conservative opposing test directives", async () => {
    const issues = await runDetector(instructionContradictionDetector, {
      "AGENTS.md": "## Testing\n\nAlways run the full test suite before committing changes.",
      ".cursor/rules/testing.mdc": "## Testing policy\n\nSkip tests when making documentation-only changes.",
    }, { language: "tsjs" });

    assert.ok(issues.some((issue) => issue.ruleId === "ai-instruction-contradiction"));
    assert.ok(issues.some((issue) => issue.message.includes("test execution policy")));
  });

  it("does not flag complementary non-contradictory policies", async () => {
    const issues = await runDetector(instructionContradictionDetector, {
      "AGENTS.md": "## Unit testing\n\nRun unit tests for all application code changes.",
      "CLAUDE.md": "## Integration testing\n\nRun integration tests when API contracts change.",
      ".cursor/rules/review.mdc": "## Review\n\nRequest human review before merging risky authentication changes.",
    }, { language: "tsjs" });

    assert.equal(issues.length, 0);
  });

  it("does not treat negated skip guidance as a contradictory skip-tests policy", async () => {
    const issues = await runDetector(instructionContradictionDetector, {
      "AGENTS.md": "## Testing\n\nAlways run the full test suite before committing changes.",
      "CLAUDE.md": "## Testing\n\nDo not skip tests for documentation-only edits.",
    }, { language: "tsjs" });

    assert.equal(issues.length, 0);
  });

  it("discovers instruction files from the scan target when they are absent from context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-ai-workflow-scope-"));
    try {
      writeFileSync(join(dir, "AGENTS.md"), "## Testing\n\nAlways run tests before committing.\n", "utf8");
      mkdirSync(join(dir, ".cursor", "rules"), { recursive: true });
      writeFileSync(
        join(dir, ".cursor", "rules", "docs.mdc"),
        "## Docs\n\nSkip tests for documentation-only edits.\n",
        "utf8",
      );

      const issues = await runDetector(instructionContradictionDetector, {}, {
        target: dir,
        language: "tsjs",
      });

      assert.ok(issues.some((issue) => issue.ruleId === "ai-instruction-contradiction"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ai-workflow-drift pack discovery", () => {
  it("adds instruction file globs when the pack is selected", () => {
    const options = mergeConfig(".", {}, { cwd: process.cwd(), pack: "ai-workflow-drift" });

    assert.deepEqual(getRulePack("ai-workflow-drift").rules, [
      "ai-instruction-duplication",
      "ai-instruction-contradiction",
    ]);
    assert.deepEqual(getRulePack("ai-workflow-drift").languages, []);
    for (const glob of INSTRUCTION_FILE_GLOBS) {
      assert.ok(options.include.includes(glob), `missing include glob ${glob}`);
    }
    for (const glob of defaultConfig.include) {
      assert.ok(!options.include.includes(glob), `unexpected TS/JS include glob ${glob}`);
    }
  });

  it("respects changedFiles scope without disk discovery", async () => {
    const issues = await runDetector(instructionContradictionDetector, {
      "AGENTS.md": "## Testing\n\nAlways run the full test suite before committing changes.",
    }, {
      language: "tsjs",
      changedFiles: ["AGENTS.md"],
    });

    assert.equal(issues.length, 0);
  });

  it("treats an empty changedFiles scope as empty instead of falling back to disk discovery", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-ai-workflow-empty-scope-"));
    try {
      writeFileSync(join(dir, "AGENTS.md"), "## Testing\n\nAlways run tests before committing.\n", "utf8");
      writeFileSync(join(dir, "CLAUDE.md"), "## Testing\n\nSkip tests for documentation-only edits.\n", "utf8");

      const issues = await runDetector(instructionContradictionDetector, {}, {
        target: dir,
        language: "tsjs",
        changedFiles: [],
      });

      assert.equal(issues.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not discover instruction files excluded by explicit include globs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-ai-workflow-include-scope-"));
    try {
      writeFileSync(join(dir, "AGENTS.md"), "## Testing\n\nAlways run tests before committing.\n", "utf8");
      writeFileSync(join(dir, "CLAUDE.md"), "## Testing\n\nSkip tests for documentation-only edits.\n", "utf8");

      const issues = await runDetector(instructionContradictionDetector, {}, {
        target: dir,
        language: "tsjs",
        include: ["**/*.ts"],
      });

      assert.equal(issues.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
