import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { getRulePack } from "../../src/config/packs.js";
import { scan } from "../../src/core/scan.js";
import {
  svelteDuplicateLogicDetector,
  svelteLargeScriptDetector,
  svelteTodoCommentDetector,
} from "../../src/detectors/svelte/index.js";
import { runDetector } from "../helpers/runDetector.js";

describe("svelte language pack", () => {
  it("scans Svelte fixtures without running React rules", async () => {
    const result = await scan({
      cwd: process.cwd(),
      target: resolve("examples/svelte"),
      include: ["**/*.svelte"],
      exclude: defaultConfig.exclude,
      minSeverity: "info",
      rules: getRulePack("svelte").rules,
      thresholds: defaultConfig.thresholds,
      maxFiles: defaultConfig.maxFiles,
    });

    assert.equal(result.summary.filesScanned, 2);
    assert.equal(result.summary.rulesRun, 3);
    assert.equal(result.summary.byRule["svelte-todo-comment"], 1);
    assert.equal(result.summary.byRule["svelte-duplicate-logic"], 1);
    assert.equal(result.summary.byRule["large-component"], undefined);
    assert.ok(result.issues.every((issue) => issue.file.endsWith(".svelte")));
  });

  it("finds Svelte script TODOs at original file lines without scanning markup", async () => {
    const source = `<script lang="ts">
  const count = 1;
  // TODO(PROJ-2): move this into a shared script module.
</script>

<!-- TODO: markup is outside the MVP -->
<button>{count}</button>
`;
    const issues = await runDetector(svelteTodoCommentDetector, { "src/Counter.svelte": source });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.file, "src/Counter.svelte");
    assert.equal(issues[0]?.location?.startLine, 3);
  });

  it("scans Svelte module and instance scripts", async () => {
    const source = `<script context="module" lang="ts">
  // TODO(PROJ-3): replace module cache.
  const cached = new Map<string, string>();
</script>

<script lang="ts">
  // TODO(PROJ-4): extract row state.
  let selected = "";
</script>

<button>{selected}</button>
`;
    const issues = await runDetector(svelteTodoCommentDetector, { "src/Stateful.svelte": source });

    assert.deepEqual(issues.map((issue) => issue.location?.startLine), [2, 7]);
  });

  it("skips Svelte files without inline script content", async () => {
    const issues = await runDetector(svelteTodoCommentDetector, {
      "src/MarkupOnly.svelte": `<!-- TODO: markup-only note --><section />`,
      "src/ExternalScript.svelte": `<script src="./logic.ts"></script><section />`,
    });

    assert.equal(issues.length, 0);
  });

  it("flags large Svelte script functions with original line locations", async () => {
    const source = `<script lang="ts">
  function routeAccount(account: { paid: boolean; failed: boolean; pending: boolean }) {
    let status = "review";
    if (account.paid) {
      status = "paid";
    } else if (account.failed) {
      status = "failed";
    } else if (account.pending) {
      status = "pending";
    }
    return status;
  }
</script>
`;
    const issues = await runDetector(svelteLargeScriptDetector, { "src/AccountPanel.svelte": source }, {
      thresholds: { "svelte-large-script.maxFunctionLines": 4, "svelte-large-script.maxBranches": 10 },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.file, "src/AccountPanel.svelte");
    assert.equal(issues[0]?.location?.startLine, 2);
  });

  it("parses TypeScript generic arrow functions as non-TSX script", async () => {
    const source = `<script lang="ts">
  const routeAccount = <T extends { paid: boolean; failed: boolean; pending: boolean }>(account: T) => {
    let status = "review";
    if (account.paid) {
      status = "paid";
    } else if (account.failed) {
      status = "failed";
    } else if (account.pending) {
      status = "pending";
    }
    return status;
  };
</script>
`;
    const issues = await runDetector(svelteLargeScriptDetector, { "src/GenericAccountPanel.svelte": source }, {
      thresholds: { "svelte-large-script.maxFunctionLines": 4, "svelte-large-script.maxBranches": 10 },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.file, "src/GenericAccountPanel.svelte");
    assert.equal(issues[0]?.location?.startLine, 2);
  });

  it("detects duplicate Svelte script functions across SFC files", async () => {
    const one = `<script lang="ts">
  function buildAccountRows(accounts: Array<{ status: string; owner: string; balance: number }>) {
    const rows: string[] = [];
    for (const account of accounts) {
      if (account.status === "closed") {
        rows.push(account.owner + ":closed");
      } else if (account.balance > 1000) {
        rows.push(account.owner + ":priority");
      } else {
        rows.push(account.owner + ":standard");
      }
    }
    return rows;
  }
</script>
`;
    const two = one.replaceAll("Account", "Invoice").replaceAll("accounts", "invoices").replaceAll("account", "invoice").replaceAll("balance", "total");

    const issues = await runDetector(svelteDuplicateLogicDetector, {
      "src/AccountList.svelte": one,
      "src/InvoiceList.svelte": two,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "svelte-duplicate-logic");
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("src/InvoiceList.svelte")));
  });
});
