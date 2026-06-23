import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { getRulePack } from "../../src/config/packs.js";
import { scan } from "../../src/core/scan.js";
import type { ScanResult } from "../../src/core/types.js";
import {
  swiftDeadAbstractionDetector,
  swiftDuplicateLogicDetector,
  swiftLargeFunctionDetector,
  swiftTodoCommentDetector,
} from "../../src/detectors/swift/index.js";
import { splitSwiftArgs } from "../../src/detectors/swift/parse.js";
import { renderReport } from "../../src/reporters/index.js";
import { runDetector } from "../helpers/runDetector.js";

function swiftScan(target: string, rules = getRulePack("swift").rules) {
  return scan({
    cwd: process.cwd(),
    target: resolve(target),
    include: ["**/*.swift"],
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

describe("swift language pack", () => {
  it("scans a Swift fixture and reports pack findings", async () => {
    const result = await swiftScan("examples/swift/src/InvoiceService.swift");

    assert.equal(result.summary.filesScanned, 1);
    assert.equal(result.summary.byRule["swift-todo-comment"], 1);
    assert.equal(result.summary.byRule["swift-duplicate-logic"], 1);
    assert.equal(result.summary.byRule["swift-dead-abstraction"], 1);
    assert.equal(result.summary.byRule["swift-large-function"], 1);
    assert.ok(result.issues.every((issue) => issue.file === "InvoiceService.swift"));
  });

  it("renders valid SARIF for Swift findings", async () => {
    const issues = await runDetector(swiftTodoCommentDetector, {
      "src/Service.swift": `
func buildInvoiceView(invoice: Invoice) -> String {
    // TODO(PROJ-42): replace sample renderer.
    return "\\(invoice.id):\\(invoice.customer)"
}
`,
    });
    const sarif = JSON.parse(renderReport({
      schemaVersion: 1,
      issues: issues as ScanResult["issues"],
      summary: {
        totalIssues: issues.length,
        bySeverity: { info: 0, low: issues.length, medium: 0, high: 0 },
        byRule: { "swift-todo-comment": issues.length },
        filesScanned: 1,
        rulesRun: 1,
        elapsedMs: 1,
      },
      options: { target: ".", include: ["**/*.swift"], exclude: [], minSeverity: "info", rules: ["swift-todo-comment"] },
    }, "sarif")) as {
      version: string;
      runs: Array<{ results: Array<{ locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }> }> }>;
    };

    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri, "src/Service.swift");
  });

  it("finds Swift line and block debt comments without matching strings or TODO calls", async () => {
    const issues = await runDetector(swiftTodoCommentDetector, {
      "src/Service.swift": `
func ignored() -> String {
    let text = "TODO in a string"
    fatalError("real Swift call")
}

// FIXME(PROJ-1): replace this fallback.
func lineComment() -> String { "line" }

/* HACK(PROJ-2): temporary block behavior. */
func blockComment() -> String { "block" }
`,
    });

    assert.equal(issues.length, 2);
    assert.deepEqual(issues.map((issue) => issue.location?.startLine), [7, 10]);
  });

  it("keeps nested Swift block comments masked as one comment", async () => {
    const issues = await runDetector(swiftTodoCommentDetector, {
      "src/Service.swift": `
/*
 FIXME(PROJ-1): replace this nested sample.
 /*
  TODO(PROJ-2): inner marker stays inside the outer comment.
 */
 if false { fatalError("commented code") }
*/
func clean() -> String {
    return "ok"
}
`,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.location?.startLine, 2);
  });

  it("detects Swift duplicate logic and ignores dissimilar functions", async () => {
    const issues = await runDetector(swiftDuplicateLogicDetector, {
      "src/Service.swift": `
func normalizeInvoice(invoice: Invoice) -> InvoiceView {
    let status = invoice.paid ? "paid" : "open"
    let bucket: String
    if invoice.total > 1000 {
        bucket = "enterprise"
    } else if invoice.total > 100 {
        bucket = "midmarket"
    } else {
        bucket = "standard"
    }
    let customer = invoice.customer.trimmingCharacters(in: .whitespacesAndNewlines)
    let resolvedCustomer = customer.isEmpty ? "unknown" : customer
    return InvoiceView(id: invoice.id, customer: resolvedCustomer, status: status, bucket: bucket)
}

func normalizeReceipt(receipt: Receipt) -> InvoiceView {
    let status = receipt.paid ? "paid" : "open"
    let bucket: String
    if receipt.total > 1000 {
        bucket = "enterprise"
    } else if receipt.total > 100 {
        bucket = "midmarket"
    } else {
        bucket = "standard"
    }
    let customer = receipt.customer.trimmingCharacters(in: .whitespacesAndNewlines)
    let resolvedCustomer = customer.isEmpty ? "unknown" : customer
    return InvoiceView(id: receipt.id, customer: resolvedCustomer, status: status, bucket: bucket)
}

func formatCustomer(customer: Customer) -> String {
    var parts: [String] = []
    if !customer.first.isEmpty { parts.append(customer.first) }
    if !customer.last.isEmpty { parts.append(customer.last) }
    return parts.joined(separator: " ")
}
`,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "swift-duplicate-logic");
    assert.match(issues[0]?.message ?? "", /normalizeInvoice/);
  });

  it("detects branch-heavy Swift functions with threshold overrides", async () => {
    const issues = await runDetector(swiftLargeFunctionDetector, {
      "src/Service.swift": `
func routeInvoice(invoice: Invoice) -> String {
    if invoice.total > 1000 { return "enterprise" }
    if !invoice.paid { return "collections" }
    if invoice.customer.isEmpty { return "unknown" }
    switch invoice.total {
    case let total where total > 500:
        return "review"
    case let total where total > 100:
        return "standard"
    default:
        return "archive"
    }
}
`,
    }, {
      thresholds: { "large-function.maxBranches": 3 },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "swift-large-function");
    assert.match(issues[0]?.message ?? "", /routeInvoice/);
  });

  it("parses generic Swift functions for function-based rules", async () => {
    const duplicateIssues = await runDetector(swiftDuplicateLogicDetector, {
      "src/Service.swift": `
func normalizeInvoice<T>(invoice: T, paid: Bool, total: Double, customer: String) -> String {
    let status = paid ? "paid" : "open"
    let bucket: String
    if total > 1000 {
        bucket = "enterprise"
    } else if total > 100 {
        bucket = "midmarket"
    } else {
        bucket = "standard"
    }
    return "\\(customer):\\(status):\\(bucket)"
}

func normalizeReceipt<U>(receipt: U, paid: Bool, total: Double, customer: String) -> String {
    let status = paid ? "paid" : "open"
    let bucket: String
    if total > 1000 {
        bucket = "enterprise"
    } else if total > 100 {
        bucket = "midmarket"
    } else {
        bucket = "standard"
    }
    return "\\(customer):\\(status):\\(bucket)"
}
`,
    });
    const largeIssues = await runDetector(swiftLargeFunctionDetector, {
      "src/Service.swift": `
func routeInvoice<T>(_ invoice: T, total: Double, paid: Bool, customer: String) -> String {
    if total > 1000 { return "enterprise" }
    if !paid { return "collections" }
    if customer.isEmpty { return "unknown" }
    return "standard"
}
`,
    }, {
      thresholds: { "large-function.maxBranches": 2 },
    });
    const wrapperIssues = await runDetector(swiftDeadAbstractionDetector, {
      "src/Service.swift": `
func renderInvoice<T>(for invoice: T) -> String {
    return buildInvoiceView(invoice: invoice)
}
`,
    });

    assert.equal(duplicateIssues.length, 1);
    assert.equal(largeIssues.length, 1);
    assert.equal(wrapperIssues.length, 1);
  });

  it("handles default parameters and skips SwiftUI view bodies and ViewBuilder functions", async () => {
    const largeIssues = await runDetector(swiftLargeFunctionDetector, {
      "src/Service.swift": `
func routeInvoice(invoice: Invoice = defaultInvoice()) -> String {
    if invoice.total > 1000 { return "enterprise" }
    if !invoice.paid { return "collections" }
    if invoice.customer.isEmpty { return "unknown" }
    switch invoice.total {
    case let total where total > 500:
        return "review"
    case let total where total > 100:
        return "standard"
    default:
        return "archive"
    }
}

struct InvoiceCard: View {
    var body: some View {
        if true { Text("branchy") }
        if false { Text("more") }
        if true { Text("branches") }
        if false { Text("ignored") }
    }

    func routeInvoice(invoice: Invoice) -> String {
        if invoice.total > 1000 { return "enterprise" }
        if !invoice.paid { return "collections" }
        if invoice.customer.isEmpty { return "unknown" }
        if invoice.overdue { return "review" }
        return "standard"
    }
}

@ViewBuilder
func renderSections() -> some View {
    if true { Text("one") }
    if false { Text("two") }
    if true { Text("three") }
    if false { Text("four") }
}
`,
    }, {
      thresholds: { "large-function.maxBranches": 3 },
    });
    const wrapperIssues = await runDetector(swiftDeadAbstractionDetector, {
      "src/Service.swift": `
func renderInvoices(prefix: String = defaultPrefix()) -> String {
    renderAllInvoices(prefix)
}
`,
    });

    assert.equal(largeIssues.length, 2);
    assert.ok(largeIssues.some((issue) => issue.message.includes("routeInvoice")));
    assert.ok(largeIssues.every((issue) => (issue.location?.endLine ?? 0) > (issue.location?.startLine ?? 0)));
    assert.equal(wrapperIssues.length, 1);
    assert.match(wrapperIssues[0]?.message ?? "", /renderInvoices/);
  });

  it("splits nested Swift arguments without treating spaces as delimiter closers", () => {
    assert.deepEqual(splitSwiftArgs(`prefix, ["paid": ["a", "b"], "open": ["c"]]` ), [
      "prefix",
      `["paid": ["a", "b"], "open": ["c"]]`,
    ]);
  });

  it("detects simple Swift wrappers and skips override, ViewBuilder, and transformed arguments", async () => {
    const issues = await runDetector(swiftDeadAbstractionDetector, {
      "src/Service.swift": `
func renderInvoice(invoice: Invoice) -> String {
    buildInvoiceView(invoice: invoice)
}

func renderReceipt(receipt: Receipt) -> String {
    return buildReceiptView(receipt: receipt)
}

func renderTransformed(invoice: Invoice) -> String {
    buildInvoiceView(invoice.copy(total: 0.0))
}

override func renderOverride(invoice: Invoice) -> String {
    buildInvoiceView(invoice)
}

@ViewBuilder
func RenderInvoice(invoice: Invoice) -> some View {
    InvoiceCard(invoice: invoice)
}
`,
    });

    assert.equal(issues.length, 2);
    assert.ok(issues.some((issue) => issue.message.includes("renderInvoice")));
    assert.ok(issues.some((issue) => issue.message.includes("renderReceipt")));
  });
});
