import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeSprawlDetector } from "../../src/detectors/routeSprawl.js";
import { runDetector } from "../helpers/runDetector.js";

describe("route-sprawl detector", () => {
  it("flags Node route modules registering too many endpoints", async () => {
    const issues = await runDetector(routeSprawlDetector, {
      "src/routes/accounts.ts": `
const router = express.Router();
router.get("/accounts", listAccounts);
router.post("/accounts", createAccount);
router.get("/accounts/:id", showAccount);
router.patch("/accounts/:id", updateAccount);
router.delete("/accounts/:id", deleteAccount);
router.post("/accounts/:id/archive", archiveAccount);
router.post("/accounts/:id/restore", restoreAccount);
router.get("/accounts/:id/events", listEvents);
router.post("/accounts/:id/events", createEvent);
export default router;
`,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "route-sprawl");
    assert.match(issues[0]?.message ?? "", /registers 9 routes/);
  });

  it("does NOT flag small route modules below the threshold", async () => {
    const issues = await runDetector(routeSprawlDetector, {
      "src/routes/health.ts": `
router.get("/health", health);
router.get("/ready", ready);
`,
    });

    assert.equal(issues.length, 0);
  });

  it("respects a custom max routes threshold", async () => {
    const issues = await runDetector(routeSprawlDetector, {
      "src/routes/sessions.ts": `
app.get("/sessions", listSessions);
app.post("/sessions", createSession);
app.delete("/sessions/:id", revokeSession);
`,
    }, {
      thresholds: { "route-sprawl.maxRoutes": 3 },
    });

    assert.equal(issues.length, 1);
  });

  it("counts Fastify object route registrations", async () => {
    const issues = await runDetector(routeSprawlDetector, {
      "src/routes/accounts.ts": `
fastify.route({ method: "GET", url: "/accounts", handler: listAccounts });
fastify.route({ method: "POST", url: "/accounts", handler: createAccount });
fastify.route({ method: "GET", url: "/accounts/:id", handler: showAccount });
fastify.route({ method: "PATCH", url: "/accounts/:id", handler: updateAccount });
fastify.route({ method: "DELETE", url: "/accounts/:id", handler: deleteAccount });
fastify.route({ method: "POST", url: "/accounts/:id/archive", handler: archiveAccount });
fastify.route({ method: "POST", url: "/accounts/:id/restore", handler: restoreAccount });
fastify.route({ method: "GET", url: "/accounts/:id/events", handler: listEvents });
`,
    });

    assert.equal(issues.length, 1);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("GET") && entry.includes("/accounts")));
  });

  it("does NOT count Hono context get calls as route registrations", async () => {
    const issues = await runDetector(routeSprawlDetector, {
      "src/routes/social-dms.ts": `
app.get("/messages", (c) => {
  const userId = c.get("userId");
  const accountId = c.get("accountId");
  const locale = c.get("locale");
  return c.json({ userId, accountId, locale });
});
`,
    }, {
      thresholds: { "route-sprawl.maxRoutes": 3 },
    });

    assert.equal(issues.length, 0);
  });
});
