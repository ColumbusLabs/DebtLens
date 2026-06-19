import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { mergeConfig } from "../../src/config/mergeConfig.js";
import { getRulePack } from "../../src/config/packs.js";
import { scan } from "../../src/core/scan.js";
import { composeLargeComposableDetector, composeStateHoistingDetector } from "../../src/detectors/compose/index.js";
import { runDetector } from "../helpers/runDetector.js";

function composeScan(target: string, rules = getRulePack("compose").rules) {
  return scan({
    cwd: process.cwd(),
    target: resolve(target),
    include: ["**/*.{kt,kts}"],
    exclude: defaultConfig.exclude,
    minSeverity: "info",
    rules,
    thresholds: {
      ...defaultConfig.thresholds,
      "compose-large-composable.maxLines": 20,
      "compose-large-composable.maxBranches": 5,
      "compose-state-hoisting.maxLocalState": 4,
    },
    maxFiles: defaultConfig.maxFiles,
    respectGitignore: defaultConfig.respectGitignore,
  });
}

describe("compose language pack", () => {
  it("scans a Compose fixture and reports pack findings", async () => {
    const result = await composeScan("examples/compose/src/BillingScreen.kt");

    assert.equal(result.summary.filesScanned, 1);
    assert.equal(result.summary.byRule["compose-large-composable"], 1);
    assert.equal(result.summary.byRule["compose-state-hoisting"], 1);
    assert.ok(result.issues.every((issue) => issue.file === "BillingScreen.kt"));
  });

  it("selects Compose independently from generic Kotlin rules", async () => {
    const options = mergeConfig(".", {}, { cwd: process.cwd(), pack: "compose" });

    assert.deepEqual(options.rules, ["compose-large-composable", "compose-state-hoisting"]);
    assert.deepEqual(options.include, ["**/*.{kt,kts}"]);
    assert.equal(options.exclude.includes("android/**"), false);
  });

  it("detects oversized branchy composables", async () => {
    const issues = await runDetector(composeLargeComposableDetector, {
      "src/BillingScreen.kt": `
@androidx.compose.runtime.Composable
fun BillingDashboard(invoices: List<Invoice>) {
    Column {
        if (invoices.isEmpty()) EmptyState()
        if (invoices.any { it.overdue }) OverdueBanner()
        if (invoices.any { it.disputed }) DisputeBanner()
        when {
            invoices.size > 100 -> LargeQueue()
            invoices.size > 20 -> MediumQueue()
            else -> SmallQueue()
        }
    }
}
`,
    }, {
      thresholds: {
        "compose-large-composable.maxLines": 40,
        "compose-large-composable.maxBranches": 3,
      },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "compose-large-composable");
    assert.match(issues[0]?.message ?? "", /BillingDashboard/);
  });

  it("detects composables that own too much local state", async () => {
    const issues = await runDetector(composeStateHoistingDetector, {
      "src/BillingScreen.kt": `
@Composable
fun BillingFilters() {
    var query by rememberSaveable {
        mutableStateOf("")
    }
    var expanded by remember {
        mutableStateOf(false)
    }
    var selectedCustomer by remember {
        mutableStateOf<String?>(null)
    }
    var showOverdue by remember { mutableStateOf(false) }
    var sortOrder by rememberSaveable { mutableStateOf("dueDate") }
    val listState = rememberLazyListState()
    Column { Text(query) }
}
`,
    }, {
      thresholds: { "compose-state-hoisting.maxLocalState": 4 },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "compose-state-hoisting");
    assert.match(issues[0]?.message ?? "", /BillingFilters/);
  });

  it("does not count commented or stringified remember state holders", async () => {
    const issues = await runDetector(composeStateHoistingDetector, {
      "src/BillingScreen.kt": `
@Composable
fun BillingFilters() {
    /*
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    var selectedCustomer by remember { mutableStateOf<String?>(null) }
    var showOverdue by remember { mutableStateOf(false) }
    var sortOrder by rememberSaveable { mutableStateOf("dueDate") }
    */
    val sample = "var ignored by remember { mutableStateOf(false) }"
    Text(sample)
}
`,
    }, {
      thresholds: { "compose-state-hoisting.maxLocalState": 1 },
    });

    assert.equal(issues.length, 0);
  });

  it("keeps small idiomatic hoisted composables quiet", async () => {
    const files = {
      "src/BillingRow.kt": `
@Composable
fun BillingSummaryRow(
    invoice: Invoice,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    onOpenInvoice: (Invoice) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier) {
        Text(invoice.customer)
        Button(onClick = { onExpandedChange(!expanded) }) { Text("Toggle") }
        Button(onClick = { onOpenInvoice(invoice) }) { Text("Open") }
    }
}
`,
    };

    assert.equal((await runDetector(composeLargeComposableDetector, files)).length, 0);
    assert.equal((await runDetector(composeStateHoistingDetector, files)).length, 0);
  });

  it("does not treat slot parameters or previews as production composable debt", async () => {
    const files = {
      "src/Slots.kt": `
fun Host(content: @Composable () -> Unit) {
    content()
}

@Preview
@Composable
fun BillingPreview() {
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    var selectedCustomer by remember { mutableStateOf<String?>(null) }
    var showOverdue by remember { mutableStateOf(false) }
    var sortOrder by rememberSaveable { mutableStateOf("dueDate") }
    val listState = rememberLazyListState()
    BillingFilters()
}
`,
    };

    assert.equal((await runDetector(composeLargeComposableDetector, files, {
      thresholds: { "compose-large-composable.maxBranches": 1, "compose-large-composable.maxLocalState": 1 },
    })).length, 0);
    assert.equal((await runDetector(composeStateHoistingDetector, files, {
      thresholds: { "compose-state-hoisting.maxLocalState": 1 },
    })).length, 0);
  });

  it("parses composables with default slot lambdas before the real body", async () => {
    const issues = await runDetector(composeStateHoistingDetector, {
      "src/Slots.kt": `
@Composable
fun BillingScaffold(
    content: @Composable () -> Unit = {},
) {
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    var selectedCustomer by remember { mutableStateOf<String?>(null) }
    var showOverdue by remember { mutableStateOf(false) }
    var sortOrder by rememberSaveable { mutableStateOf("dueDate") }
    val listState = rememberLazyListState()
    content()
}
`,
    }, {
      thresholds: { "compose-state-hoisting.maxLocalState": 4 },
    });

    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /BillingScaffold/);
  });

  it("does not skip production composables just because the name ends with Preview", async () => {
    const issues = await runDetector(composeStateHoistingDetector, {
      "src/Preview.kt": `
@Composable
fun InvoicePreview() {
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    var selectedCustomer by remember { mutableStateOf<String?>(null) }
    var showOverdue by remember { mutableStateOf(false) }
    var sortOrder by rememberSaveable { mutableStateOf("dueDate") }
    val listState = rememberLazyListState()
    Text(query)
}
`,
    }, {
      thresholds: { "compose-state-hoisting.maxLocalState": 4 },
    });

    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /InvoicePreview/);
  });
});
