import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { namingDriftDetector, resolveConceptGroups } from "../../src/detectors/namingDrift.js";
import { runDetector } from "../helpers/runDetector.js";

describe("naming-drift vocabulary", () => {
  it("includes the built-in pack by default", () => {
    const groups = resolveConceptGroups();
    assert.ok(groups.some((g) => g.id === "media-entity"));
    assert.ok(groups.some((g) => g.id === "time-of-release"));
  });

  it("adds user-supplied concept groups", () => {
    const groups = resolveConceptGroups({ "commerce-entity": ["product", "sku"] });
    const commerce = groups.find((g) => g.id === "commerce-entity");
    assert.ok(commerce);
    assert.equal(commerce?.label, "commerce entity");
    assert.deepEqual(commerce?.variants, ["product", "sku"]);
    // built-ins are still present
    assert.ok(groups.some((g) => g.id === "media-entity"));
  });

  it("flags drift using a custom vocabulary group", async () => {
    const src = `
const product = 1;
const sku = 2;
const listing = 3;
const inventoryRecord = 4;
export { product, sku, listing, inventoryRecord };
`;
    const issues = await runDetector(
      namingDriftDetector,
      { "catalog.ts": src },
      { vocabulary: { "commerce-entity": ["product", "sku", "listing", "inventory"] } },
    );
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /commerce entity/);
  });
});
