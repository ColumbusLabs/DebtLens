import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { getRulePack } from "../../src/config/packs.js";
import { scan } from "../../src/core/scan.js";
import {
  pythonDeadAbstractionDetector,
  pythonDuplicateLogicDetector,
  pythonTodoCommentDetector,
} from "../../src/detectors/python/index.js";
import { renderReport } from "../../src/reporters/index.js";
import { runDetector } from "../helpers/runDetector.js";

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
    const issues = await runDetector(pythonTodoCommentDetector, {
      "service.py": `
def build_invoice_view(invoice):
    # TODO(PROJ-42): replace sample renderer with the real billing formatter.
    return f"{invoice['id']}:{invoice['customer']}"
`,
    });
    const sarif = JSON.parse(renderReport({
      schemaVersion: 1,
      issues,
      summary: {
        totalIssues: issues.length,
        bySeverity: { info: 0, low: issues.length, medium: 0, high: 0 },
        byRule: { "python-todo-comment": issues.length },
        filesScanned: 1,
        rulesRun: 1,
        elapsedMs: 1,
      },
      options: { target: ".", include: ["**/*.py"], exclude: [], minSeverity: "info", rules: ["python-todo-comment"] },
    }, "sarif")) as {
      version: string;
      runs: Array<{ results: Array<{ locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }> }> }>;
    };

    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri, "service.py");
  });

  it("does not flag dissimilar Python functions as duplicate logic", async () => {
    const issues = await runDetector(pythonDuplicateLogicDetector, {
      "src/service.py": `
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
`,
    });

    assert.equal(issues.length, 0);
  });

  it("detects async def functions and skips decorator lines when parsing bodies", async () => {
    const issues = await runDetector(pythonDeadAbstractionDetector, {
      "src/service.py": `
@router.get("/items")
async def list_items(session):
    return await fetch_items(session)


async def load_items(session):
    return await fetch_items(session)
`,
    });

    assert.equal(issues.length, 2);
    assert.ok(issues.some((issue) => issue.message.includes("list_items")));
    assert.ok(issues.some((issue) => issue.message.includes("load_items")));
  });

  it("does not flag Python wrappers that add behavior", async () => {
    const issues = await runDetector(pythonDeadAbstractionDetector, {
      "src/service.py": `
def render_invoice(invoice):
    enriched = dict(invoice)
    enriched["rendered"] = True
    return build_invoice_view(enriched)
`,
    });

    assert.equal(issues.length, 0);
  });
});
