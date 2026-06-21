import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commentedOutCodeDetector } from "../../src/detectors/commentedOutCode.js";
import { runDetector } from "../helpers/runDetector.js";

describe("commented-out-code detector", () => {
  it("flags a multi-line commented-out block", async () => {
    const src = `
/*
const old = fetchData();
return old;
*/
export const x = 1;
`;
    const issues = await runDetector(commentedOutCodeDetector, { "x.ts": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "commented-out-code");
    assert.equal(issues[0]?.location?.startLine, 2);
    assert.ok((issues[0]?.confidence ?? 0) >= 0.6);
  });

  it("flags contiguous line comments that look like code", async () => {
    const src = `
// const a = 1;
// const b = a + 2;
export const x = 1;
`;
    const issues = await runDetector(commentedOutCodeDetector, { "x.ts": src });
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /commented-out code/);
  });

  it("does not flag a license header", async () => {
    const src = `
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 Example Corp
export const x = 1;
`;
    const issues = await runDetector(commentedOutCodeDetector, { "x.ts": src });
    assert.equal(issues.length, 0);
  });

  it("does not flag TODO marker comments", async () => {
    const src = `
// TODO: remove after launch
// const legacy = old();
export const x = 1;
`;
    const issues = await runDetector(commentedOutCodeDetector, { "x.ts": src });
    assert.equal(issues.length, 0);
  });

  it("does not flag a single commented-out line below minLines", async () => {
    const src = `
// const x = 1;
export const y = 2;
`;
    const issues = await runDetector(commentedOutCodeDetector, { "x.ts": src });
    assert.equal(issues.length, 0);
  });

  it("raises confidence for longer commented-out runs", async () => {
    const short = await runDetector(commentedOutCodeDetector, {
      "short.ts": "// const a = 1;\n// return a;\nexport const x = 1;\n",
    });
    const long = await runDetector(commentedOutCodeDetector, {
      "long.ts": [
        "// const a = 1;",
        "// const b = 2;",
        "// const c = 3;",
        "// const d = 4;",
        "// return a + b + c + d;",
        "export const x = 1;",
      ].join("\n"),
    });

    assert.equal(short.length, 1);
    assert.equal(long.length, 1);
    assert.ok((long[0]?.confidence ?? 0) > (short[0]?.confidence ?? 1));
    assert.ok((long[0]?.confidence ?? 0) <= 0.8);
  });
});
