import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { getRulePack } from "../../src/config/packs.js";
import { scan } from "../../src/core/scan.js";
import type { ScanResult } from "../../src/core/types.js";
import {
  rubyDeadAbstractionDetector,
  rubyDuplicateLogicDetector,
  rubyLargeFunctionDetector,
  rubyTodoCommentDetector,
} from "../../src/detectors/ruby/index.js";
import { extractRubyFunctions, splitRubyArgs } from "../../src/detectors/ruby/parse.js";
import { renderReport } from "../../src/reporters/index.js";
import { runDetector } from "../helpers/runDetector.js";

function rubyScan(target: string, rules = getRulePack("ruby").rules) {
  return scan({
    cwd: process.cwd(),
    target: resolve(target),
    include: ["**/*.rb"],
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

describe("ruby language pack", () => {
  it("scans a Ruby fixture and reports pack findings", async () => {
    const result = await rubyScan("examples/ruby/src/billing_service.rb");

    assert.equal(result.summary.filesScanned, 1);
    assert.equal(result.summary.byRule["ruby-todo-comment"], 1);
    assert.equal(result.summary.byRule["ruby-duplicate-logic"], 1);
    assert.equal(result.summary.byRule["ruby-dead-abstraction"], 1);
    assert.equal(result.summary.byRule["ruby-large-function"], 1);
    assert.ok(result.issues.every((issue) => issue.file === "billing_service.rb"));
  });

  it("renders valid SARIF for Ruby findings", async () => {
    const issues = await runDetector(rubyTodoCommentDetector, {
      "src/service.rb": `
def build_invoice_view(invoice)
  # TODO(PROJ-42): replace sample renderer.
  "#{invoice.id}:#{invoice.customer}"
end
`,
    });
    const sarif = JSON.parse(renderReport({
      schemaVersion: 1,
      issues: issues as ScanResult["issues"],
      summary: {
        totalIssues: issues.length,
        bySeverity: { info: 0, low: issues.length, medium: 0, high: 0 },
        byRule: { "ruby-todo-comment": issues.length },
        filesScanned: 1,
        rulesRun: 1,
        elapsedMs: 1,
      },
      options: { target: ".", include: ["**/*.rb"], exclude: [], minSeverity: "info", rules: ["ruby-todo-comment"] },
    }, "sarif")) as {
      version: string;
      runs: Array<{ results: Array<{ locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }> }> }>;
    };

    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri, "src/service.rb");
  });

  it("finds Ruby line and block debt comments without matching strings", async () => {
    const issues = await runDetector(rubyTodoCommentDetector, {
      "src/service.rb": `
def ignored
  text = "TODO in a string"
end

# FIXME(PROJ-1): replace this fallback.
def line_comment
  "line"
end

=begin
HACK(PROJ-2): temporary block behavior.
=end
def block_comment
  "block"
end
`,
    });

    assert.equal(issues.length, 2);
    assert.deepEqual(issues.map((issue) => issue.location?.startLine), [6, 11]);
  });

  it("detects Ruby duplicate logic and ignores dissimilar methods", async () => {
    const issues = await runDetector(rubyDuplicateLogicDetector, {
      "src/service.rb": `
def normalize_invoice(invoice)
  status = invoice.paid ? "paid" : "open"
  bucket = if invoice.total > 1000
             "enterprise"
           elsif invoice.total > 100
             "midmarket"
           else
             "standard"
           end
  customer = invoice.customer.strip
  customer = "unknown" if customer.empty?
  InvoiceView.new(id: invoice.id, customer: customer, status: status, bucket: bucket)
end

def normalize_receipt(receipt)
  status = receipt.paid ? "paid" : "open"
  bucket = if receipt.total > 1000
             "enterprise"
           elsif receipt.total > 100
             "midmarket"
           else
             "standard"
           end
  customer = receipt.customer.strip
  customer = "unknown" if customer.empty?
  InvoiceView.new(id: receipt.id, customer: customer, status: status, bucket: bucket)
end

def format_customer(customer)
  parts = []
  parts << customer.first unless customer.first.strip.empty?
  parts << customer.last unless customer.last.strip.empty?
  parts.join(" ")
end
`,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "ruby-duplicate-logic");
    assert.match(issues[0]?.message ?? "", /normalize_invoice/);
  });

  it("detects branch-heavy Ruby methods with threshold overrides", async () => {
    const issues = await runDetector(rubyLargeFunctionDetector, {
      "src/service.rb": `
def route_invoice(invoice)
  return "enterprise" if invoice.total > 1000
  return "collections" unless invoice.paid
  return "unknown" if invoice.customer.strip.empty?
  case invoice.total
  when 501.. then "review"
  when 101..500 then "standard"
  else "archive"
  end
end
`,
    }, {
      thresholds: { "large-function.maxBranches": 3 },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "ruby-large-function");
    assert.match(issues[0]?.message ?? "", /route_invoice/);
  });

  it("splits nested Ruby arguments without treating spaces as delimiter closers", () => {
    assert.deepEqual(splitRubyArgs('prefix, { "paid" => ["a", "b"], "open" => ["c"] }'), [
      "prefix",
      '{ "paid" => ["a", "b"], "open" => ["c"] }',
    ]);
  });

  it("keeps method spans when bodies include nested while/until blocks", () => {
    const file = {
      absolutePath: "/tmp/service.rb",
      relativePath: "service.rb",
      content: `
def reconcile_invoice(invoice)
  while invoice.pending?
    apply_credit(invoice)
  end
  until invoice.settled?
    notify_owner(invoice)
  end
  invoice
end
`,
      language: "ruby" as const,
      sourceFile: undefined!,
    };

    const methods = extractRubyFunctions(file);
    assert.equal(methods.length, 1);
    assert.equal(methods[0]?.name, "reconcile_invoice");
    assert.equal(methods[0]?.endLine - methods[0]!.startLine + 1, 9);
  });

  it("keeps postfix conditionals from swallowing visibility changes", () => {
    const file = {
      absolutePath: "/tmp/accounts_controller.rb",
      relativePath: "accounts_controller.rb",
      content: `
class AccountsController
  def show
    return head :not_found unless @account
    render json: @account
  end

  private

  def account_params
    params.require(:account)
  end
end
`,
      language: "ruby" as const,
      sourceFile: undefined!,
    };

    const methods = extractRubyFunctions(file);
    assert.deepEqual(methods.map((method) => [method.name, method.visibility]), [
      ["show", "public"],
      ["account_params", "private"],
    ]);
    assert.equal(methods[0]?.text.includes("private"), false);
  });

  it("detects simple Ruby wrappers and skips private methods", async () => {
    const issues = await runDetector(rubyDeadAbstractionDetector, {
      "src/service.rb": `
def render_invoice(invoice)
  build_invoice_view(invoice)
end

def render_receipt(receipt)
  build_receipt_view(receipt)
end

def render_transformed(invoice)
  build_invoice_view(invoice.merge(total: 0.0))
end

private

def render_private(invoice)
  build_invoice_view(invoice)
end
`,
    });

    assert.equal(issues.length, 2);
    assert.ok(issues.some((issue) => issue.message.includes("render_invoice")));
    assert.ok(issues.some((issue) => issue.message.includes("render_receipt")));
  });
});
