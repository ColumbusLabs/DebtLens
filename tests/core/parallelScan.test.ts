import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveConcurrency, shardFiles } from "../../src/core/parallelScan.js";

describe("parallel scan helpers", () => {
  it("shards files deterministically", async () => {
    const shards = await shardFiles(["a.ts", "b.ts", "c.ts", "d.ts"], 2);
    assert.equal(shards.length, 2);
    assert.deepEqual(shards[0], ["a.ts", "c.ts"]);
    assert.deepEqual(shards[1], ["b.ts", "d.ts"]);
  });

  it("defaults concurrency to 1 unless configured", () => {
    assert.equal(resolveConcurrency({ concurrency: 3 } as never), 3);
    assert.equal(resolveConcurrency({} as never), 1);
  });
});
