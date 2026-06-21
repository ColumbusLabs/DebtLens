import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { mergeConfig } from "../../src/config/mergeConfig.js";
import { getRulePack } from "../../src/config/packs.js";
import { scan } from "../../src/core/scan.js";
import { swiftuiLargeViewDetector, swiftuiStateSprawlDetector } from "../../src/detectors/swiftui/index.js";
import { runDetector } from "../helpers/runDetector.js";

function swiftuiScan(target: string, rules = getRulePack("swiftui").rules) {
  return scan({
    cwd: process.cwd(),
    target: resolve(target),
    include: ["**/*.swift"],
    exclude: defaultConfig.exclude,
    minSeverity: "info",
    rules,
    thresholds: {
      ...defaultConfig.thresholds,
      "swiftui-large-view.maxLines": 20,
      "swiftui-large-view.maxBranches": 5,
      "swiftui-state-sprawl.maxStateHolders": 4,
    },
    maxFiles: defaultConfig.maxFiles,
    respectGitignore: defaultConfig.respectGitignore,
  });
}

describe("swiftui language pack", () => {
  it("scans a SwiftUI fixture and reports pack findings", async () => {
    const result = await swiftuiScan("examples/swiftui/src/BillingDashboardScreen.swift");

    assert.equal(result.summary.filesScanned, 1);
    assert.equal(result.summary.byRule["swiftui-large-view"], 1);
    assert.equal(result.summary.byRule["swiftui-state-sprawl"], 1);
    assert.ok(result.issues.every((issue) => issue.file === "BillingDashboardScreen.swift"));
  });

  it("selects SwiftUI independently from generic Swift rules", async () => {
    const options = mergeConfig(".", {}, { cwd: process.cwd(), pack: "swiftui" });

    assert.deepEqual(options.rules, ["swiftui-large-view", "swiftui-state-sprawl"]);
    assert.deepEqual(options.include, ["**/*.swift"]);
    assert.equal(options.exclude.includes("ios/**"), false);
  });

  it("detects oversized branchy SwiftUI views", async () => {
    const issues = await runDetector(swiftuiLargeViewDetector, {
      "src/BillingDashboardScreen.swift": `
struct BillingDashboardScreen: View {
    let invoices: [Invoice]

    var body: some View {
        VStack {
            if invoices.isEmpty { EmptyState() }
            if invoices.contains(where: { $0.overdue }) { OverdueBanner() }
            if invoices.contains(where: { $0.disputed }) { DisputeBanner() }
            switch invoices.count {
            case let count where count > 100: LargeQueue()
            case let count where count > 20: MediumQueue()
            default: SmallQueue()
            }
        }
    }
}
`,
    }, {
      thresholds: {
        "swiftui-large-view.maxLines": 40,
        "swiftui-large-view.maxBranches": 3,
      },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "swiftui-large-view");
    assert.match(issues[0]?.message ?? "", /BillingDashboardScreen/);
  });

  it("detects views that own too much local state", async () => {
    const issues = await runDetector(swiftuiStateSprawlDetector, {
      "src/BillingFilters.swift": `
struct BillingFilters: View {
    @State private var query = ""
    @State private var expanded = false
    @State private var selectedCustomer: String?
    @State private var showOverdue = false
    @AppStorage("sortOrder") private var sortOrder = "dueDate"
    @StateObject private var model = FilterModel()
    @FocusState private var focused: Bool

    var body: some View {
        Text(query)
    }
}
`,
    }, {
      thresholds: { "swiftui-state-sprawl.maxStateHolders": 4 },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "swiftui-state-sprawl");
    assert.match(issues[0]?.message ?? "", /BillingFilters/);
  });

  it("counts argument-bearing SwiftUI storage wrappers at threshold boundaries", async () => {
    const issues = await runDetector(swiftuiStateSprawlDetector, {
      "src/BillingFilters.swift": `
struct BillingFilters: View {
    @State private var query = ""
    @State private var expanded = false
    @State private var selectedCustomer: String?
    @AppStorage("sortOrder") private var sortOrder = "dueDate"

    var body: some View {
        Text(query)
    }
}
`,
    }, {
      thresholds: { "swiftui-state-sprawl.maxStateHolders": 3 },
    });

    assert.equal(issues.length, 1);
    assert.match((issues[0]?.evidence ?? []).join(" "), /sortOrder/);
  });

  it("counts SwiftUI large-view branches only inside body", async () => {
    const issues = await runDetector(swiftuiLargeViewDetector, {
      "src/FormatterView.swift": `
struct FormatterView: View {
    let formatter: NumberFormatter = {
        let formatter = NumberFormatter()
        if Locale.current.usesMetricSystem {
            formatter.maximumFractionDigits = 2
        } else {
            formatter.maximumFractionDigits = 1
        }
        return formatter
    }()

    var body: some View {
        Text("ready")
    }
}
`,
    }, {
      thresholds: {
        "swiftui-large-view.maxLines": 40,
        "swiftui-large-view.maxBranches": 0,
        "swiftui-large-view.maxLocalState": 10,
      },
    });

    assert.equal(issues.length, 0);
  });

  it("does not count commented or stringified state holders", async () => {
    const issues = await runDetector(swiftuiStateSprawlDetector, {
      "src/BillingFilters.swift": `
struct BillingFilters: View {
    /*
    @State private var query = ""
    @State private var expanded = false
    @State private var selectedCustomer: String?
  */
    let sample = "@State private var ignored = false"
    var body: some View { Text(sample) }
}
`,
    }, {
      thresholds: { "swiftui-state-sprawl.maxStateHolders": 1 },
    });

    assert.equal(issues.length, 0);
  });

  it("keeps small idiomatic hoisted views quiet", async () => {
    const files = {
      "src/BillingRow.swift": `
struct BillingSummaryRow: View {
    let invoice: Invoice
    let expanded: Bool
    let onExpandedChange: (Bool) -> Void
    let onOpenInvoice: (Invoice) -> Void

    var body: some View {
        HStack {
            Text(invoice.customer)
            Button("Toggle") { onExpandedChange(!expanded) }
            Button("Open") { onOpenInvoice(invoice) }
        }
    }
}
`,
    };

    assert.equal((await runDetector(swiftuiLargeViewDetector, files)).length, 0);
    assert.equal((await runDetector(swiftuiStateSprawlDetector, files)).length, 0);
  });

  it("does not treat previews as production SwiftUI debt", async () => {
    const files = {
      "src/Preview.swift": `
#Preview {
    struct BillingPreview: View {
        @State private var query = ""
        @State private var expanded = false
        @State private var selectedCustomer: String?
        @State private var showOverdue = false
        @AppStorage("sortOrder") private var sortOrder = "dueDate"
        @StateObject private var model = FilterModel()
        @FocusState private var focused: Bool

        var body: some View {
            BillingFilters()
        }
    }
    return BillingPreview()
}
`,
    };

    assert.equal((await runDetector(swiftuiLargeViewDetector, files, {
      thresholds: { "swiftui-large-view.maxBranches": 1, "swiftui-large-view.maxLocalState": 1 },
    })).length, 0);
    assert.equal((await runDetector(swiftuiStateSprawlDetector, files, {
      thresholds: { "swiftui-state-sprawl.maxStateHolders": 1 },
    })).length, 0);
  });

  it("does not skip production views just because the name ends with Preview", async () => {
    const issues = await runDetector(swiftuiStateSprawlDetector, {
      "src/Preview.swift": `
struct InvoicePreview: View {
    @State private var query = ""
    @State private var expanded = false
    @State private var selectedCustomer: String?
    @State private var showOverdue = false
    @AppStorage("sortOrder") private var sortOrder = "dueDate"
    @StateObject private var model = FilterModel()
    @FocusState private var focused: Bool

    var body: some View {
        Text(query)
    }
}
`,
    }, {
      thresholds: { "swiftui-state-sprawl.maxStateHolders": 4 },
    });

    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /InvoicePreview/);
  });
});
