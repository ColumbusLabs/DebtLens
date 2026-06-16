import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hookDependencySmellDetector } from "../../src/detectors/hookDependencySmell.js";
import { runDetector } from "../helpers/runDetector.js";

describe("hook-dependency-smell detector", () => {
  it("flags inline object, array, and function literals in hook dependency arrays", async () => {
    const src = `
export function SearchPanel({ userId, query }: Props) {
  useEffect(() => {
    refresh();
  }, [{ userId }, [query], () => query.trim()]);
  return null;
}
`;
    const issues = await runDetector(hookDependencySmellDetector, { "SearchPanel.tsx": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "hook-dependency-smell");
    assert.match(issues[0]?.message ?? "", /3 inline dependency values/);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("inline object")));
    assert.equal(issues[0]?.severity, "medium");
  });

  it("flags useMemo dependencies with a single inline literal", async () => {
    const src = `
export function SearchPanel({ userId }: Props) {
  const rows = useMemo(() => buildRows(userId), [{ userId }]);
  return <Table rows={rows} />;
}
`;
    const issues = await runDetector(hookDependencySmellDetector, { "SearchPanel.tsx": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.severity, "low");
    assert.match(issues[0]?.message ?? "", /useMemo/);
  });

  it("does NOT flag stable primitive and identifier dependencies", async () => {
    const src = `
export function SearchPanel({ userId, query }: Props) {
  const rows = useMemo(() => buildRows(userId, query), [userId, query, 1, "ready"]);
  useEffect(() => {
    refresh(rows);
  }, [rows]);
  return <Table rows={rows} />;
}
`;
    const issues = await runDetector(hookDependencySmellDetector, { "SearchPanel.tsx": src });
    assert.equal(issues.length, 0);
  });
});
