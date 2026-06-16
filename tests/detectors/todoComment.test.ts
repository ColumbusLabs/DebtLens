import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { todoCommentDetector } from "../../src/detectors/todoComment.js";
import { runDetector } from "../helpers/runDetector.js";

describe("todo-comment detector", () => {
  it("flags a TODO marker in a comment", async () => {
    const src = `
// TODO: split this when the launch rush is over.
export const x = 1;
`;
    const issues = await runDetector(todoCommentDetector, { "x.ts": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "todo-comment");
    assert.match(issues[0]?.message ?? "", /todo marker/);
  });

  it("boosts confidence for tracker-linked TODO markers", async () => {
    const bare = await runDetector(todoCommentDetector, { "bare.ts": "// TODO: split this later\n" });
    const linked = await runDetector(todoCommentDetector, { "linked.ts": "// TODO(JIRA-123): split this later\n" });

    assert.equal(bare.length, 1);
    assert.equal(linked.length, 1);
    assert.ok((linked[0]?.confidence ?? 0) > (bare[0]?.confidence ?? 1));
    assert.ok(linked[0]?.evidence?.some((entry) => entry.includes("Tracker-linked")));
  });

  it("ranks FIXME higher than TODO", async () => {
    const src = `// FIXME: this is broken\nexport const x = 1;\n`;
    const issues = await runDetector(todoCommentDetector, { "x.ts": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.severity, "medium");
  });

  it("does NOT flag a non-comment line that merely contains the word", async () => {
    const src = `export const todoList = [];\n`;
    const issues = await runDetector(todoCommentDetector, { "x.ts": src });
    assert.equal(issues.length, 0);
  });

  it("flags a custom marker from config", async () => {
    const src = `// REVISIT: tighten this after launch\nexport const x = 1;\n`;
    const issues = await runDetector(todoCommentDetector, { "x.ts": src }, {
      todoCommentMarkers: [{ pattern: "REVISIT", label: "revisit marker", severity: "medium" }],
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /revisit marker/);
    assert.equal(issues[0]?.severity, "medium");
  });

  it("does NOT flag a disabled default marker", async () => {
    const src = `// TODO: split this later\nexport const x = 1;\n`;
    const issues = await runDetector(todoCommentDetector, { "x.ts": src }, {
      todoCommentDisableDefaults: ["todo marker"],
    });
    assert.equal(issues.length, 0);
  });

  it("uses only custom markers when replaceDefaults is true", async () => {
    const src = `// TODO: ignored\n// REVISIT: flagged\nexport const x = 1;\n`;
    const issues = await runDetector(todoCommentDetector, { "x.ts": src }, {
      todoCommentReplaceDefaults: true,
      todoCommentMarkers: [{ pattern: "REVISIT", label: "revisit marker" }],
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /revisit marker/);
  });
});
