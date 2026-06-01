import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommaList, parseThresholds } from "../../src/cli/parseList.js";

describe("parseCommaList", () => {
  it("splits, trims, and drops empty entries", () => {
    assert.deepEqual(parseCommaList("a, b ,c,"), ["a", "b", "c"]);
  });

  it("returns undefined for empty or missing input", () => {
    assert.equal(parseCommaList(undefined), undefined);
    assert.equal(parseCommaList(""), undefined);
    assert.equal(parseCommaList(" , , "), undefined);
  });

  it("accepts an array and flattens comma-joined members", () => {
    assert.deepEqual(parseCommaList(["a,b", "c"]), ["a", "b", "c"]);
  });
});

describe("parseThresholds", () => {
  it("parses key=value pairs into numbers", () => {
    assert.deepEqual(parseThresholds("large-component.maxLines=300,state-sprawl.maxStatefulHooks=8"), {
      "large-component.maxLines": 300,
      "state-sprawl.maxStatefulHooks": 8,
    });
  });

  it("throws on a malformed entry", () => {
    assert.throws(() => parseThresholds("large-component.maxLines"), /Invalid threshold/);
  });

  it("throws on a non-numeric value", () => {
    assert.throws(() => parseThresholds("large-component.maxLines=lots"), /Invalid numeric threshold/);
  });

  it("returns undefined for missing input", () => {
    assert.equal(parseThresholds(undefined), undefined);
  });
});
