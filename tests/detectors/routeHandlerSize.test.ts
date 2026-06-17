import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeHandlerSizeDetector } from "../../src/detectors/routeHandlerSize.js";
import { runDetector } from "../helpers/runDetector.js";

describe("route-handler-size detector", () => {
  it("flags app route modules over the await threshold", async () => {
    const src = `
export async function GET() {
  const a = await one();
  const b = await two();
  const c = await three();
  return Response.json({ a, b, c });
}
`;
    const issues = await runDetector(
      routeHandlerSizeDetector,
      { "app/api/report/route.ts": src },
      { thresholds: { "route-handler-size.maxAwaits": 3 } },
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "route-handler-size");
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("Await expressions: 3 / 3")));
  });

  it("flags pages api routes over the branch threshold", async () => {
    const src = `
export default async function handler(req, res) {
  if (!req.user) return res.status(401).end();
  if (req.method === "POST") return res.json(await create());
  if (req.method === "PATCH") return res.json(await update());
  return res.status(405).end();
}
`;
    const issues = await runDetector(
      routeHandlerSizeDetector,
      { "pages/api/report.ts": src },
      { thresholds: { "route-handler-size.maxBranches": 3 } },
    );
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /pages\/api\/report/);
  });

  it("flags app page modules over the line threshold", async () => {
    const src = `
export default function Page() {
  const rows = [];
  rows.push(1);
  rows.push(2);
  rows.push(3);
  rows.push(4);
  return <main>{rows.length}</main>;
}
`;
    const issues = await runDetector(
      routeHandlerSizeDetector,
      { "app/reports/page.tsx": src },
      { thresholds: { "route-handler-size.maxLines": 8 } },
    );
    assert.equal(issues.length, 1);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("Lines: 8 / 8")));
  });

  it("does NOT flag small focused route modules", async () => {
    const src = `
export async function GET() {
  return Response.json(await loadReport());
}
`;
    const issues = await runDetector(
      routeHandlerSizeDetector,
      { "app/api/report/route.ts": src },
      {
        thresholds: {
          "route-handler-size.maxAwaits": 3,
          "route-handler-size.maxBranches": 3,
          "route-handler-size.maxLines": 20,
        },
      },
    );
    assert.equal(issues.length, 0);
  });

  it("does NOT flag large non-route modules", async () => {
    const src = `
export async function loadReport() {
  if (a) await one();
  if (b) await two();
  if (c) await three();
  return {};
}
`;
    const issues = await runDetector(
      routeHandlerSizeDetector,
      { "src/server/report.ts": src },
      { thresholds: { "route-handler-size.maxAwaits": 2, "route-handler-size.maxBranches": 2 } },
    );
    assert.equal(issues.length, 0);
  });
});
