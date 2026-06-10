import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { levenshtein, suggestClosest } from "../../src/utils/didYouMean.js";
import { detectorIds } from "../../src/detectors/index.js";

describe("levenshtein", () => {
  it("measures edit distance", () => {
    assert.equal(levenshtein("todo-comment", "todo-comment"), 0);
    assert.equal(levenshtein("todo-comments", "todo-comment"), 1);
    assert.equal(levenshtein("", "abc"), 3);
    assert.equal(levenshtein("kitten", "sitting"), 3);
  });
});

describe("suggestClosest", () => {
  it("suggests the canonical rule id for a plural typo", () => {
    assert.equal(suggestClosest("todo-comments", detectorIds), "todo-comment");
  });

  it("suggests across transposed and dropped characters", () => {
    assert.equal(suggestClosest("prop-driling", detectorIds), "prop-drilling");
    assert.equal(suggestClosest("naming-dirft", detectorIds), "naming-drift");
  });

  it("returns undefined when nothing is plausibly close", () => {
    assert.equal(suggestClosest("zzzz", detectorIds), undefined);
  });
});
