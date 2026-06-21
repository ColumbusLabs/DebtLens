import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { getRulePack } from "../../src/config/packs.js";
import { scan } from "../../src/core/scan.js";
import {
  kotlinDeadAbstractionDetector,
  kotlinDuplicateLogicDetector,
  kotlinEmptyCatchDetector,
  kotlinLargeFunctionDetector,
  kotlinTodoCommentDetector,
} from "../../src/detectors/kotlin/index.js";
import { splitKotlinArgs } from "../../src/detectors/kotlin/parse.js";
import { renderReport } from "../../src/reporters/index.js";
import { runDetector } from "../helpers/runDetector.js";

function kotlinScan(target: string, rules = getRulePack("kotlin").rules) {
  return scan({
    cwd: process.cwd(),
    target: resolve(target),
    include: ["**/*.{kt,kts}"],
    exclude: defaultConfig.exclude,
    minSeverity: "info",
    rules,
    thresholds: {
      ...defaultConfig.thresholds,
      "large-function.maxBranches": 4,
    },
    maxFiles: defaultConfig.maxFiles,
    respectGitignore: defaultConfig.respectGitignore,
  });
}

describe("kotlin language pack", () => {
  it("scans a Kotlin fixture and reports pack findings", async () => {
    const result = await kotlinScan("examples/kotlin/src/InvoiceService.kt");

    assert.equal(result.summary.filesScanned, 1);
    assert.equal(result.summary.byRule["kotlin-todo-comment"], 1);
    assert.equal(result.summary.byRule["kotlin-duplicate-logic"], 1);
    assert.equal(result.summary.byRule["kotlin-dead-abstraction"], 1);
    assert.equal(result.summary.byRule["kotlin-large-function"], 1);
    assert.ok(result.issues.every((issue) => issue.file === "InvoiceService.kt"));
  });

  it("renders valid SARIF for Kotlin findings", async () => {
    const issues = await runDetector(kotlinTodoCommentDetector, {
      "src/Service.kt": `
fun buildInvoiceView(invoice: Invoice): String {
    // TODO(PROJ-42): replace sample renderer.
    return "\${invoice.id}:\${invoice.customer}"
}
`,
    });
    const sarif = JSON.parse(renderReport({
      schemaVersion: 1,
      issues,
      summary: {
        totalIssues: issues.length,
        bySeverity: { info: 0, low: issues.length, medium: 0, high: 0 },
        byRule: { "kotlin-todo-comment": issues.length },
        filesScanned: 1,
        rulesRun: 1,
        elapsedMs: 1,
      },
      options: { target: ".", include: ["**/*.kt"], exclude: [], minSeverity: "info", rules: ["kotlin-todo-comment"] },
    }, "sarif")) as {
      version: string;
      runs: Array<{ results: Array<{ locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }> }> }>;
    };

    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri, "src/Service.kt");
  });

  it("finds Kotlin line, block, and KDoc debt comments without matching strings or TODO calls", async () => {
    const issues = await runDetector(kotlinTodoCommentDetector, {
      "src/Service.kt": `
fun ignored(): String {
    val text = "TODO in a string"
    return TODO("real Kotlin call")
}

// FIXME(PROJ-1): replace this fallback.
fun lineComment() = "line"

/* HACK(PROJ-2): temporary block behavior. */
fun blockComment() = "block"

/**
 * TODO(PROJ-3): document real behavior.
 */
fun kdocComment() = "docs"
`,
    });

    assert.equal(issues.length, 3);
    assert.deepEqual(issues.map((issue) => issue.location?.startLine), [7, 10, 13]);
  });

  it("detects Kotlin duplicate logic and ignores dissimilar functions", async () => {
    const issues = await runDetector(kotlinDuplicateLogicDetector, {
      "src/Service.kt": `
fun normalizeInvoice(invoice: Invoice): InvoiceView {
    val status = if (invoice.paid) "paid" else "open"
    val bucket = when {
        invoice.total > 1000 -> "enterprise"
        invoice.total > 100 -> "midmarket"
        else -> "standard"
    }
    val customer = invoice.customer.trim().ifBlank { "unknown" }
    return InvoiceView(invoice.id, customer, status, bucket)
}

fun normalizeReceipt(receipt: Receipt): InvoiceView {
    val status = if (receipt.paid) "paid" else "open"
    val bucket = when {
        receipt.total > 1000 -> "enterprise"
        receipt.total > 100 -> "midmarket"
        else -> "standard"
    }
    val customer = receipt.customer.trim().ifBlank { "unknown" }
    return InvoiceView(receipt.id, customer, status, bucket)
}

fun formatCustomer(customer: Customer): String {
    val parts = mutableListOf<String>()
    if (customer.first.isNotBlank()) parts.add(customer.first)
    if (customer.last.isNotBlank()) parts.add(customer.last)
    return parts.joinToString(" ")
}
`,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "kotlin-duplicate-logic");
    assert.match(issues[0]?.message ?? "", /normalizeInvoice/);
  });

  it("does not treat semantic no-op API hooks as duplicate logic", async () => {
    const issues = await runDetector(kotlinDuplicateLogicDetector, {
      "src/EventListener.kt": `
open fun dispatcherQueueStart(
    call: Call,
    dispatcher: Dispatcher,
    startedAtMillis: Long,
) {
}

open fun dispatcherQueueEnd(
    call: Call,
    dispatcher: Dispatcher,
    endedAtMillis: Long,
) {
    // default no-op hook
}
`,
    }, {
      thresholds: { "duplicate-logic.minLines": 3 },
    });

    assert.equal(issues.length, 0);
  });

  it("detects branch-heavy Kotlin functions with threshold overrides", async () => {
    const issues = await runDetector(kotlinLargeFunctionDetector, {
      "src/Service.kt": `
fun routeInvoice(invoice: Invoice): String {
    if (invoice.total > 1000) return "enterprise"
    if (!invoice.paid) return "collections"
    if (invoice.customer.isBlank()) return "unknown"
    return when {
        invoice.total > 500 -> "review"
        invoice.total > 100 -> "standard"
        else -> "archive"
    }
}
`,
    }, {
      thresholds: { "large-function.maxBranches": 3 },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "kotlin-large-function");
    assert.match(issues[0]?.message ?? "", /routeInvoice/);
  });

  it("handles default parameters and generic nullable extension receivers", async () => {
    const largeIssues = await runDetector(kotlinLargeFunctionDetector, {
      "src/Service.kt": `
fun routeInvoice(invoice: Invoice = defaultInvoice()): String {
    if (invoice.total > 1000) return "enterprise"
    if (!invoice.paid) return "collections"
    if (invoice.customer.isBlank()) return "unknown"
    return when {
        invoice.total > 500 -> "review"
        invoice.total > 100 -> "standard"
        else -> "archive"
    }
}
`,
    }, {
      thresholds: { "large-function.maxBranches": 3 },
    });
    const wrapperIssues = await runDetector(kotlinDeadAbstractionDetector, {
      "src/Service.kt": `
fun List<Invoice?>.renderInvoices(prefix: String = defaultPrefix()) = renderAllInvoices(prefix)
`,
    });

    assert.equal(largeIssues.length, 1);
    assert.ok((largeIssues[0]?.location?.endLine ?? 0) > (largeIssues[0]?.location?.startLine ?? 0));
    assert.equal(wrapperIssues.length, 1);
    assert.match(wrapperIssues[0]?.message ?? "", /renderInvoices/);
  });

  it("splits nested Kotlin arguments without treating spaces as delimiter closers", () => {
    assert.deepEqual(splitKotlinArgs(`prefix, mapOf("paid" to listOf("a", "b"), "open" to listOf("c"))`), [
      "prefix",
      `mapOf("paid" to listOf("a", "b"), "open" to listOf("c"))`,
    ]);
  });

  it("detects simple Kotlin wrappers and skips override, Compose, and transformed arguments", async () => {
    const issues = await runDetector(kotlinDeadAbstractionDetector, {
      "src/Service.kt": `
fun renderInvoice(invoice: Invoice) = buildInvoiceView(invoice)

fun renderReceipt(receipt: Receipt): String {
    return buildReceiptView(receipt)
}

fun renderTransformed(invoice: Invoice) = buildInvoiceView(invoice.copy(total = 0.0))

override fun renderOverride(invoice: Invoice) = buildInvoiceView(invoice)

@Composable
fun RenderInvoice(invoice: Invoice) = InvoiceCard(invoice)

open fun onCallStart(call: Call): Unit = Unit

open fun onCallEnd(call: Call) {
    return Unit
}
`,
    });

    assert.equal(issues.length, 2);
    assert.ok(issues.some((issue) => issue.message.includes("renderInvoice")));
    assert.ok(issues.some((issue) => issue.message.includes("renderReceipt")));
  });
});

describe("kotlin-empty-catch detector", () => {
  it("flags empty and comment-only catch blocks", async () => {
    const issues = await runDetector(kotlinEmptyCatchDetector, {
      "src/Service.kt": `
fun load(path: String): String {
    try {
        return read(path)
    } catch (error: Exception) {
    }
}

fun parse(value: String): Int {
    try {
        return value.toInt()
    } catch (error: NumberFormatException) {
        // ignored on purpose
    }
}
`,
    });

    assert.equal(issues.length, 2);
    assert.ok(issues.every((issue) => issue.ruleId === "kotlin-empty-catch"));
    assert.ok(issues.some((issue) => issue.message.includes("empty")));
    assert.ok(issues.some((issue) => issue.message.includes("comment")));
  });

  it("does not flag catch blocks that handle errors", async () => {
    const issues = await runDetector(kotlinEmptyCatchDetector, {
      "src/Service.kt": `
fun parse(value: String): Int {
    try {
        return value.toInt()
    } catch (error: NumberFormatException) {
        throw error
    }
}
`,
    });

    assert.equal(issues.length, 0);
  });

  it("does not flag catch examples inside normal or triple-quoted strings", async () => {
    const issues = await runDetector(kotlinEmptyCatchDetector, {
      "src/Service.kt": `
fun docs(): String {
    val inline = "try { read(path) } catch (error: Exception) { }"
    val block = """
        try {
            read(path)
        } catch (error: Exception) {
        }
    """
    return inline + block
}
`,
    });

    assert.equal(issues.length, 0);
  });

  it("still flags real catch blocks after ignored examples", async () => {
    const issues = await runDetector(kotlinEmptyCatchDetector, {
      "src/Service.kt": `
val docs = """
try {
    read(path)
} catch (error: Exception) {
}
"""

fun load(path: String): String {
    try {
        return read(path)
    } catch (error: Exception) {
    }
}
`,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "kotlin-empty-catch");
  });

  it("emits raw findings when a central suppression directive is present", async () => {
    const issues = await runDetector(kotlinEmptyCatchDetector, {
      "src/Service.kt": `
fun load(path: String): String {
    try {
        return read(path)
    // debtlens-disable-next-line kotlin-empty-catch -- vendor SDK throws benign noise
    } catch (error: Exception) {
    }
}
`,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "kotlin-empty-catch");
  });
});
