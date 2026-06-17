import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serverClientBoundaryDetector } from "../../src/detectors/serverClientBoundary.js";
import { runDetector } from "../helpers/runDetector.js";

describe("server-client-boundary detector", () => {
  it("flags client files importing server-only modules", async () => {
    const src = `
"use client";

import { cookies } from "next/headers";

export function Preferences() {
  return <button>{cookies().get("theme")?.value}</button>;
}
`;
    const issues = await runDetector(serverClientBoundaryDetector, { "app/settings/Preferences.tsx": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "server-client-boundary");
    assert.match(issues[0]?.message ?? "", /use client/);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("next/headers")));
  });

  it("flags server components using client-only hooks", async () => {
    const src = `
import { useEffect, useState } from "react";

export default function Page() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(1);
  }, []);
  return <main>{count}</main>;
}
`;
    const issues = await runDetector(serverClientBoundaryDetector, { "app/dashboard/page.tsx": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.severity, "high");
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("useState")));
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("useEffect")));
  });

  it("does NOT flag client components using client hooks", async () => {
    const src = `
"use client";

import { useState } from "react";

export function Counter() {
  const [count] = useState(0);
  return <button>{count}</button>;
}
`;
    const issues = await runDetector(serverClientBoundaryDetector, { "app/dashboard/Counter.tsx": src });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag server components without client hooks", async () => {
    const src = `
import { cookies } from "next/headers";

export default function Page() {
  const theme = cookies().get("theme")?.value ?? "system";
  return <main>{theme}</main>;
}
`;
    const issues = await runDetector(serverClientBoundaryDetector, { "app/dashboard/page.tsx": src });
    assert.equal(issues.length, 0);
  });
});
