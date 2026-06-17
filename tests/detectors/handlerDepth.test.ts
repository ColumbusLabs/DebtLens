import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handlerDepthDetector } from "../../src/detectors/handlerDepth.js";
import { runDetector } from "../helpers/runDetector.js";

describe("handler-depth detector", () => {
  it("flags deeply nested Express-style route handlers", async () => {
    const issues = await runDetector(handlerDepthDetector, {
      "src/routes/accounts.ts": `
router.post("/accounts/:id/payments", async (req, res) => {
  if (req.user) {
    try {
      if (req.body.amount) {
        for (const invoice of req.body.invoices) {
          if (invoice.open) {
            await pay(invoice);
          }
        }
      }
    } catch (error) {
      res.status(500).send(error);
    }
  }
});
`,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "handler-depth");
  });

  it("does NOT flag flat focused handlers", async () => {
    const issues = await runDetector(handlerDepthDetector, {
      "src/routes/health.ts": `
router.get("/health", async (_req, res) => {
  const status = await getStatus();
  res.json(status);
});
`,
    });

    assert.equal(issues.length, 0);
  });

  it("respects a custom max depth threshold", async () => {
    const issues = await runDetector(handlerDepthDetector, {
      "src/routes/sessions.ts": `
fastify.get("/sessions", async (req, reply) => {
  if (req.user) {
    return reply.send(await listSessions(req.user));
  }
});
`,
    }, {
      thresholds: { "handler-depth.maxDepth": 1 },
    });

    assert.equal(issues.length, 1);
  });
});
