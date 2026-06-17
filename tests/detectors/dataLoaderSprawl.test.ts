import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dataLoaderSprawlDetector } from "../../src/detectors/dataLoaderSprawl.js";
import { runDetector } from "../helpers/runDetector.js";

describe("data-loader-sprawl detector", () => {
  it("flags async server components with many fetch calls", async () => {
    const src = `
export default async function Page() {
  const account = await fetch("/api/account");
  const invoices = await fetch("/api/invoices");
  const payments = await fetch("/api/payments");
  const alerts = await fetch("/api/alerts");
  return <main>{account.status}{invoices.status}{payments.status}{alerts.status}</main>;
}
`;
    const issues = await runDetector(
      dataLoaderSprawlDetector,
      { "app/dashboard/page.tsx": src },
      {
        thresholds: {
          "data-loader-sprawl.maxFetches": 4,
          "data-loader-sprawl.maxAwaits": 4,
        },
      },
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "data-loader-sprawl");
    assert.match(issues[0]?.message ?? "", /Page performs 4 awaits and 4 fetch calls/);
  });

  it("flags loader-named functions outside app server component files", async () => {
    const src = `
export async function loadDashboardData() {
  const a = await db.account.findMany();
  const b = await db.invoice.findMany();
  const c = await db.payment.findMany();
  return { a, b, c };
}
`;
    const issues = await runDetector(
      dataLoaderSprawlDetector,
      { "src/server/loaders/dashboard.ts": src },
      { thresholds: { "data-loader-sprawl.maxAwaits": 3 } },
    );
    assert.equal(issues.length, 1);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("Await expressions: 3 / 3")));
  });

  it("does NOT flag small focused loaders", async () => {
    const src = `
export async function loadInvoice(id: string) {
  const invoice = await db.invoice.findUnique({ where: { id } });
  return invoice;
}
`;
    const issues = await runDetector(
      dataLoaderSprawlDetector,
      { "src/server/loaders/invoice.ts": src },
      { thresholds: { "data-loader-sprawl.maxAwaits": 3, "data-loader-sprawl.maxFetches": 3 } },
    );
    assert.equal(issues.length, 0);
  });

  it("does NOT flag client components with several browser-side awaits", async () => {
    const src = `
"use client";

export async function refreshEverything() {
  await a();
  await b();
  await c();
  await d();
}
`;
    const issues = await runDetector(
      dataLoaderSprawlDetector,
      { "app/dashboard/client-tools.tsx": src },
      { thresholds: { "data-loader-sprawl.maxAwaits": 3 } },
    );
    assert.equal(issues.length, 0);
  });

  it("flags branchy loader paths when shape thresholds are exceeded", async () => {
    const src = `
export async function loadDashboardData(flags) {
  if (flags.account) return loadAccount();
  if (flags.invoices) return loadInvoices();
  if (flags.payments) return loadPayments();
  if (flags.alerts) return loadAlerts();
  if (flags.tasks) return loadTasks();
  return {};
}
`;
    const issues = await runDetector(
      dataLoaderSprawlDetector,
      { "src/server/loaders/dashboard.ts": src },
      { thresholds: { "data-loader-sprawl.maxBranches": 5 } },
    );

    assert.equal(issues.length, 1);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("Branch points: 5 / 5")));
  });
});
