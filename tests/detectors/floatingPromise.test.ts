import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { floatingPromiseDetector } from "../../src/detectors/floatingPromise.js";
import { runDetector } from "../helpers/runDetector.js";

describe("floating-promise detector", () => {
  it("does NOT flag an awaited promise", async () => {
    const src = `
export async function load() {
  await fetch("/api");
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "load.ts": src });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag a returned promise", async () => {
    const src = `
export function load() {
  return fetch("/api");
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "load.ts": src });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag a void-marked fire-and-forget call by default", async () => {
    const src = `
export function load() {
  void fetch("/api");
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "load.ts": src });
    assert.equal(issues.length, 0);
  });

  it("flags void-marked calls when allowVoid is disabled", async () => {
    const src = `
export function load() {
  void fetch("/api");
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "load.ts": src }, {
      thresholds: { "floating-promise.allowVoid": 0 },
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "floating-promise");
  });

  it("does NOT flag a promise chain with .catch()", async () => {
    const src = `
export function load() {
  fetch("/api").catch(handleError);
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "load.ts": src });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag a promise chain with a rejection-only .then handler", async () => {
    const src = `
export function load() {
  fetch("/api").then(undefined, handleError);
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "load.ts": src });
    assert.equal(issues.length, 0);
  });

  it("still flags a promise chain with a fulfilled .then handler and no catch", async () => {
    const src = `
export function load() {
  fetch("/api").then((response) => response.json(), handleError);
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "load.ts": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "floating-promise");
  });

  it("flags a bare fetch call", async () => {
    const src = `
export function load() {
  fetch("/api");
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "load.ts": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "floating-promise");
    assert.match(issues[0]?.message ?? "", /not awaited/i);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("fetch")));
  });

  it("flags an async function call without await", async () => {
    const src = `
async function loadData() {
  return 1;
}

export function run() {
  loadData();
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "run.ts": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "floating-promise");
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("async function")));
  });

  it("flags fire-and-forget work inside useEffect", async () => {
    const src = `
export function Widget() {
  useEffect(() => {
    fetch("/api");
  }, []);
  return null;
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "Widget.tsx": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "floating-promise");
    assert.match(issues[0]?.message ?? "", /useEffect/);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("Inside React effect")));
  });

  it("does NOT flag a promise passed as an argument", async () => {
    const src = `
export function run(task: Promise<void>) {
  queue(task);
}

export function load() {
  run(fetch("/api"));
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "load.ts": src });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag storing a promise-valued argument in a Map", async () => {
    const src = `
const inFlightByUser = new Map<string, Promise<Response>>();

export function load(userId: string) {
  inFlightByUser.set(userId, fetch(\`/api/users/\${userId}\`));
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "load.ts": src });
    assert.equal(issues.length, 0);
  });

  it("emits raw findings when a central suppression directive is present", async () => {
    const src = `
export function load() {
  // debtlens-disable-next-line floating-promise -- intentional fire-and-forget
  fetch("/api");
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "load.ts": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "floating-promise");
  });

  it("caps findings per file", async () => {
    const src = `
export function load() {
  fetch("/1");
  fetch("/2");
  fetch("/3");
}
`;
    const issues = await runDetector(floatingPromiseDetector, { "load.ts": src }, {
      thresholds: { "floating-promise.maxPerFile": 2 },
    });
    assert.equal(issues.length, 2);
  });
});
