import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { storyOnlyComponentDetector } from "../../src/detectors/storyOnlyComponent.js";
import { runDetector } from "../helpers/runDetector.js";

describe("story-only-component detector", () => {
  it("flags an exported component imported only by a story file", async () => {
    const component = `
export function EmptyStateCard() {
  return <section>No rows yet</section>;
}
`;
    const story = `
import { EmptyStateCard } from "./EmptyStateCard";

export default { component: EmptyStateCard };
export const Default = {};
`;
    const issues = await runDetector(storyOnlyComponentDetector, {
      "EmptyStateCard.tsx": component,
      "EmptyStateCard.stories.tsx": story,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "story-only-component");
    assert.match(issues[0]?.message ?? "", /only Storybook story files/);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("EmptyStateCard.stories.tsx")));
  });

  it("does NOT flag a story component that is also shared by app code", async () => {
    const component = `
export function EmptyStateCard() {
  return <section>No rows yet</section>;
}
`;
    const story = `
import { EmptyStateCard } from "./EmptyStateCard";
export default { component: EmptyStateCard };
`;
    const app = `
import { EmptyStateCard } from "./EmptyStateCard";

export function Dashboard() {
  return <EmptyStateCard />;
}
`;
    const issues = await runDetector(storyOnlyComponentDetector, {
      "EmptyStateCard.tsx": component,
      "EmptyStateCard.stories.tsx": story,
      "Dashboard.tsx": app,
    });

    assert.equal(issues.length, 0);
  });

  it("flags story-only components imported through a local barrel", async () => {
    const component = `
export function EmptyStateCard() {
  return <section>No rows yet</section>;
}
`;
    const barrel = `
export { EmptyStateCard } from "./EmptyStateCard";
`;
    const story = `
import { EmptyStateCard } from "./index";
export default { component: EmptyStateCard };
`;
    const issues = await runDetector(storyOnlyComponentDetector, {
      "EmptyStateCard.tsx": component,
      "index.ts": barrel,
      "EmptyStateCard.stories.tsx": story,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "story-only-component");
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("EmptyStateCard.stories.tsx")));
  });

  it("does NOT flag unexported components inside story files", async () => {
    const story = `
function LocalStoryOnly() {
  return <section>Only for this story</section>;
}

export default { component: LocalStoryOnly };
`;
    const issues = await runDetector(storyOnlyComponentDetector, { "LocalOnly.stories.tsx": story });
    assert.equal(issues.length, 0);
  });
});
