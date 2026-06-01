import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deadAbstractionDetector } from "../../src/detectors/deadAbstraction.js";
import { runDetector } from "../helpers/runDetector.js";

describe("dead-abstraction detector", () => {
  it("flags a thin wrapper that only renders a single JSX element", async () => {
    const src = `
export function Hero(props) {
  return <section>{props.title}</section>;
}
`;
    const issues = await runDetector(deadAbstractionDetector, { "Hero.tsx": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "dead-abstraction");
    assert.match(issues[0]?.message ?? "", /thin wrapper/);
  });

  // Guards the design-system false-positive risk: a wrapper that does real work
  // (more than one statement) must NOT be flagged.
  it("does NOT flag a wrapper that adds behavior", async () => {
    const src = `
export function Hero(props) {
  const title = props.title.trim().toUpperCase();
  return <section className={props.className}>{title}</section>;
}
`;
    const issues = await runDetector(deadAbstractionDetector, { "Hero.tsx": src });
    assert.equal(issues.length, 0);
  });

  // Expo Router / Next.js route modules are thin wrappers by convention.
  it("does NOT flag route modules under app/ or pages/", async () => {
    const route = `
export default function FollowersRoute() {
  return <FollowListScreen />;
}
`;
    const appIssues = await runDetector(deadAbstractionDetector, { "app/followers.tsx": route });
    const pageIssues = await runDetector(deadAbstractionDetector, { "pages/followers.tsx": route });
    assert.equal(appIssues.length, 0);
    assert.equal(pageIssues.length, 0);
  });

  // Composing another hook is idiomatic, not a dead abstraction.
  it("does NOT flag a hook that delegates to another hook", async () => {
    const src = `
export function useIsSaved(id) {
  return useSaveStore((state) => Boolean(state.savedById[id]));
}
`;
    const issues = await runDetector(deadAbstractionDetector, { "src/state/save-store.ts": src });
    assert.equal(issues.length, 0);
  });

  // ...but a non-hook delegation wrapper is still flagged.
  it("still flags a plain function that only delegates to another function", async () => {
    const src = `
export function getCopy(locale) {
  return buildCopy(locale);
}
`;
    const issues = await runDetector(deadAbstractionDetector, { "src/copy.ts": src });
    assert.equal(issues.length, 1);
  });
});
