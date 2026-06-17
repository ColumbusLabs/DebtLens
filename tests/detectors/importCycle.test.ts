import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importCycleDetector } from "../../src/detectors/importCycle.js";
import { runDetector } from "../helpers/runDetector.js";

describe("import-cycle detector", () => {
  it("detects a simple two-file relative import cycle", async () => {
    const issues = await runDetector(importCycleDetector, {
      "src/a.ts": "import { b } from './b';\nexport const a = b;\n",
      "src/b.ts": "import { a } from './a';\nexport const b = a;\n",
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "import-cycle");
    assert.match(issues[0]?.message ?? "", /2-file cycle/);
    assert.deepEqual(issues[0]?.evidence, ["src/a.ts", "imports src/b.ts", "imports src/a.ts"]);
  });

  it("ignores type-only imports by default and can count them when configured", async () => {
    const files = {
      "src/a.ts": "import type { B } from './b';\nexport type A = B;\n",
      "src/b.ts": "import type { A } from './a';\nexport type B = A;\n",
    };

    const ignored = await runDetector(importCycleDetector, files);
    const counted = await runDetector(importCycleDetector, files, {
      thresholds: { "import-cycle.allowTypeOnly": 0 },
    });

    assert.equal(ignored.length, 0);
    assert.equal(counted.length, 1);
  });
});
