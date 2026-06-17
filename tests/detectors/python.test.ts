import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { getRulePack } from "../../src/config/packs.js";
import { scan } from "../../src/core/scan.js";
import { renderReport } from "../../src/reporters/index.js";

function pythonScan(target: string, rules = getRulePack("python").rules) {
  return scan({
    cwd: process.cwd(),
    target: resolve(target),
    include: ["**/*.py"],
    exclude: defaultConfig.exclude,
    minSeverity: "info",
    rules,
    thresholds: defaultConfig.thresholds,
    maxFiles: defaultConfig.maxFiles,
    respectGitignore: defaultConfig.respectGitignore,
  });
}

describe("python language pack", () => {
  it("scans a single Python file and reports pack findings", async () => {
    const result = await pythonScan("examples/python/src/service.py");

    assert.equal(result.summary.filesScanned, 1);
    assert.equal(result.summary.byRule["python-todo-comment"], 1);
    assert.equal(result.summary.byRule["python-duplicate-logic"], 1);
    assert.equal(result.summary.byRule["python-dead-abstraction"], 1);
    assert.ok(result.issues.every((issue) => issue.file === "service.py"));
  });

  it("renders valid SARIF for Python findings", async () => {
    const result = await pythonScan("examples/python/src/service.py", ["python-todo-comment"]);
    const sarif = JSON.parse(renderReport(result, "sarif")) as {
      version: string;
      runs: Array<{ results: Array<{ locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }> }> }>;
    };

    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri, "service.py");
  });

  it("does not flag dissimilar Python functions as duplicate logic", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-python-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "service.py"), `
def parse_invoice(invoice):
    total = 0
    for line in invoice["lines"]:
        total += line["amount"]
    status = "paid" if invoice.get("paid") else "open"
    return {"total": total, "status": status}


def format_customer(customer):
    parts = []
    if customer.get("first"):
        parts.append(customer["first"])
    if customer.get("last"):
        parts.append(customer["last"])
    return " ".join(parts)
`, "utf8");

      const result = await pythonScan(dir, ["python-duplicate-logic"]);

      assert.equal(result.summary.totalIssues, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not flag Python wrappers that add behavior", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-python-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "service.py"), `
def render_invoice(invoice):
    enriched = dict(invoice)
    enriched["rendered"] = True
    return build_invoice_view(enriched)
`, "utf8");

      const result = await pythonScan(dir, ["python-dead-abstraction"]);

      assert.equal(result.summary.totalIssues, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
