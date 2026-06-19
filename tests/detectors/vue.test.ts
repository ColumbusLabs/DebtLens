import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { getRulePack } from "../../src/config/packs.js";
import { scan } from "../../src/core/scan.js";
import {
  vueDuplicateLogicDetector,
  vueLargeScriptDetector,
  vueTodoCommentDetector,
} from "../../src/detectors/vue/index.js";
import { runDetector } from "../helpers/runDetector.js";

describe("vue language pack", () => {
  it("scans Vue fixtures and maps findings to .vue files", async () => {
    const result = await scan({
      cwd: process.cwd(),
      target: resolve("examples/vue"),
      include: ["**/*.vue"],
      exclude: defaultConfig.exclude,
      minSeverity: "info",
      rules: getRulePack("vue").rules,
      thresholds: defaultConfig.thresholds,
      maxFiles: defaultConfig.maxFiles,
    });

    assert.equal(result.summary.filesScanned, 2);
    assert.equal(result.summary.rulesRun, 3);
    assert.equal(result.summary.byRule["vue-todo-comment"], 1);
    assert.equal(result.summary.byRule["vue-duplicate-logic"], 1);
    assert.ok(result.issues.every((issue) => issue.file.endsWith(".vue")));
  });

  it("finds script setup TODOs at original Vue file lines without scanning templates", async () => {
    const source = `<template>
  <!-- TODO: template copy is not part of the MVP -->
</template>

<script setup lang="ts">
const count = 1;
// TODO(PROJ-1): move this into a composable.
</script>
`;
    const issues = await runDetector(vueTodoCommentDetector, { "src/Counter.vue": source });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.file, "src/Counter.vue");
    assert.equal(issues[0]?.location?.startLine, 7);
  });

  it("parses quoted Vue script setup attributes that contain >", async () => {
    const source = `<script setup generic="T extends { id: string }>" lang="ts">
const count = 1;
// TODO(PROJ-5): move generic row setup into a composable.
</script>
`;
    const issues = await runDetector(vueTodoCommentDetector, { "src/GenericRows.vue": source });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.file, "src/GenericRows.vue");
    assert.equal(issues[0]?.location?.startLine, 3);
  });

  it("skips Vue files without inline script content", async () => {
    const issues = await runDetector(vueTodoCommentDetector, {
      "src/StaticOnly.vue": `<template><!-- TODO: template-only note --><section /></template>`,
      "src/ExternalScript.vue": `<script src="./logic.ts"></script><template><section /></template>`,
    });

    assert.equal(issues.length, 0);
  });

  it("flags large Vue script functions with original line locations", async () => {
    const source = `<template><section /></template>

<script setup lang="ts">
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
    const issues = await runDetector(vueLargeScriptDetector, { "src/AccountPanel.vue": source }, {
      thresholds: { "vue-large-script.maxFunctionLines": 4, "vue-large-script.maxBranches": 10 },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.file, "src/AccountPanel.vue");
    assert.equal(issues[0]?.location?.startLine, 4);
  });

  it("parses TypeScript generic arrow functions as non-TSX script", async () => {
    const source = `<script setup lang="ts">
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
    const issues = await runDetector(vueLargeScriptDetector, { "src/GenericAccountPanel.vue": source }, {
      thresholds: { "vue-large-script.maxFunctionLines": 4, "vue-large-script.maxBranches": 10 },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.file, "src/GenericAccountPanel.vue");
    assert.equal(issues[0]?.location?.startLine, 2);
  });

  it("detects duplicate Vue script functions across SFC files", async () => {
    const one = `<script setup lang="ts">
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

    const issues = await runDetector(vueDuplicateLogicDetector, {
      "src/AccountList.vue": one,
      "src/InvoiceList.vue": two,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "vue-duplicate-logic");
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("src/InvoiceList.vue")));
  });
});
