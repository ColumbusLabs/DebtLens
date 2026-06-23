import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractBraceBodyLines,
  findMatchingDelimiter,
  fingerprintNormalizedSnippet,
  maskScannedRanges,
  maskRange,
  normalizeSnippetText,
  scanSlashTrivia,
  splitDelimitedArgs,
} from "../../src/detectors/shared/parsePrimitives.js";

describe("shared parse primitives", () => {
  it("splits delimited arguments while preserving nested commas", () => {
    assert.deepEqual(splitDelimitedArgs(`prefix, mapOf("paid" to listOf("a", "b"), "open" to listOf("c"))`, {
      includeAngleBrackets: true,
    }), [
      "prefix",
      `mapOf("paid" to listOf("a", "b"), "open" to listOf("c"))`,
    ]);
    assert.deepEqual(splitDelimitedArgs(`prefix, { "paid" => ["a", "b"], "open" => ["c"] }`), [
      "prefix",
      `{ "paid" => ["a", "b"], "open" => ["c"] }`,
    ]);
  });

  it("finds matching delimiters across nested and quoted delimiters", () => {
    const text = `call(first, nested(")"), list(second))`;

    assert.equal(findMatchingDelimiter(text, text.indexOf("("), "(", ")"), text.length - 1);
  });

  it("normalizes identifiers and fingerprints structural tokens", () => {
    const normalized = normalizeSnippetText(`fun load(userId: String) { return "paid-\${userId}" }`, {
      maskComments: (text) => text,
      keywords: new Set(["fun", "return"]),
    });

    assert.equal(normalized, "fun ID(ID: ID) { return ID }");
    assert.equal(fingerprintNormalizedSnippet(normalized).get("return"), 1);
    assert.equal(fingerprintNormalizedSnippet(normalized).get("{"), 1);
  });

  it("scans slash comments, nested block comments, and strings with stable ranges", () => {
    const text = `val a = "literal // not comment"\n/* outer /* inner */ done */\nval b = 1 // trailing`;
    const comments: string[] = [];
    const strings: string[] = [];

    scanSlashTrivia(text, {
      onComment: (comment) => comments.push(comment),
      onString: (start, end) => strings.push(text.slice(start, end)),
    });

    assert.deepEqual(strings, [`"literal // not comment"`]);
    assert.deepEqual(comments, ["/* outer /* inner */ done */", "// trailing"]);
    assert.equal(maskScannedRanges(text, scanSlashTrivia, { includeStrings: true }), "val a =                         \n                            \nval b = 1            ");
  });

  it("masks ranges without disturbing line numbers and extracts brace bodies", () => {
    const chars = [..."alpha\nbravo"];
    maskRange(chars, 0, chars.length);

    assert.equal(chars.join(""), "     \n     ");
    assert.deepEqual(extractBraceBodyLines(["fun load() {", "  return 1", "}"]), ["", "  return 1", ""]);
  });
});
