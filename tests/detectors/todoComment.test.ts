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
});
