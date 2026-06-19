import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import type { SourceFileInfo } from "../../src/core/types.js";
import { defaultConfig } from "../../src/config/defaults.js";
import { getRulePack } from "../../src/config/packs.js";
import { scan } from "../../src/core/scan.js";
import {
  pythonComplexControlFlowDetector,
  pythonDeadAbstractionDetector,
  pythonDuplicateLogicDetector,
  pythonLargeFunctionDetector,
  pythonRouteSprawlDetector,
  pythonTodoCommentDetector,
} from "../../src/detectors/python/index.js";
import { extractPythonFunctions, extractPythonModule } from "../../src/detectors/python/parse.js";
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

function pythonFile(content: string, relativePath = "src/service.py"): SourceFileInfo {
  return {
    absolutePath: `/${relativePath}`,
    relativePath,
    content,
    language: "python",
    sourceFile: undefined as unknown as SourceFileInfo["sourceFile"],
  };
}

describe("python language pack", () => {
  it("scans a single Python file and reports pack findings", async () => {
    const result = await pythonScan("examples/python/src/service.py");

    assert.equal(result.summary.filesScanned, 1);
    assert.equal(result.summary.byRule["python-todo-comment"], 1);
    assert.equal(result.summary.byRule["python-duplicate-logic"], 1);
    assert.equal(result.summary.byRule["python-large-function"], 1);
    assert.equal(result.summary.byRule["python-complex-control-flow"], 1);
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

  it("uses the Python AST sidecar for async functions, decorators, classes, imports, and nested functions", () => {
    const moduleInfo = extractPythonModule(pythonFile(`
from django.urls import path, re_path as regex_path
import flask as flask_mod

@controller
class InvoiceView:
    # TODO: replace sample route
    @bp.get("/invoices")
    async def list(self, account):
        def normalize(value):
            return value
        return await fetch(account)
`));

    assert.equal(moduleInfo.usedAstSidecar, true);
    assert.deepEqual(moduleInfo.imports.map((entry) => entry.kind), ["from", "import"]);
    assert.equal(moduleInfo.imports[0]?.module, "django.urls");
    assert.deepEqual(moduleInfo.imports[0]?.names, ["path", "re_path as regex_path"]);
    assert.equal(moduleInfo.comments[0]?.text, "# TODO: replace sample route");
    assert.equal(moduleInfo.classes[0]?.qualifiedName, "InvoiceView");
    assert.equal(moduleInfo.classes[0]?.decorators[0]?.text, "controller");

    const method = moduleInfo.functions.find((fn) => fn.qualifiedName === "InvoiceView.list");
    assert.equal(method?.kind, "method");
    assert.equal(method?.parentClass, "InvoiceView");
    assert.equal(method?.isAsync, true);
    assert.deepEqual(method?.params, ["self", "account"]);
    assert.equal(method?.decorators?.[0]?.text, "bp.get(\"/invoices\")");
    assert.equal(method?.startLine, 9);

    const nested = moduleInfo.functions.find((fn) => fn.qualifiedName === "InvoiceView.list.normalize");
    assert.equal(nested?.kind, "nested-function");
    assert.deepEqual(nested?.params, ["value"]);
  });

  it("warns and falls back to text parsing when the Python runtime is unavailable", () => {
    const warnings: string[] = [];
    const functions = extractPythonFunctions(pythonFile(`
def passthrough(value):
    return render(value)
`), {
      addWarning: (warning) => warnings.push(warning),
      pythonCommands: ["debtlens-python-that-does-not-exist"],
    });

    assert.equal(functions.length, 1);
    assert.equal(functions[0]?.name, "passthrough");
    assert.match(warnings[0] ?? "", /Python AST sidecar unavailable/);
  });

  it("tries the next Python command when an earlier candidate starts but fails", () => {
    const warnings: string[] = [];
    const moduleInfo = extractPythonModule(pythonFile(`
async def load(value):
    return value
`), {
      addWarning: (warning) => warnings.push(warning),
      pythonCommands: [process.execPath, "python3", "python"],
    });

    assert.equal(moduleInfo.usedAstSidecar, true);
    assert.equal(moduleInfo.functions[0]?.isAsync, true);
    assert.deepEqual(warnings, []);
  });

  it("isolates the Python sidecar from repo-local stdlib module shadows", () => {
    const previousCwd = process.cwd();
    const sandbox = mkdtempSync(join(tmpdir(), "debtlens-python-sidecar-"));
    const marker = join(sandbox, "local-import-executed");
    const maliciousModule = `
from pathlib import Path
Path(${JSON.stringify(marker)}).write_text("executed")
raise RuntimeError("repo-local stdlib shadow imported")
`;

    writeFileSync(join(sandbox, "ast.py"), maliciousModule);
    writeFileSync(join(sandbox, "tokenize.py"), maliciousModule);

    try {
      process.chdir(sandbox);
      const warnings: string[] = [];
      const moduleInfo = extractPythonModule(pythonFile(`
def isolated(value):
    return value
`, "shadowed.py"), {
        addWarning: (warning) => warnings.push(warning),
      });

      assert.equal(moduleInfo.usedAstSidecar, true);
      assert.equal(moduleInfo.functions[0]?.name, "isolated");
      assert.deepEqual(warnings, []);
      assert.equal(existsSync(marker), false);
    } finally {
      process.chdir(previousCwd);
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("warns and falls back to text parsing when AST parsing fails", () => {
    const warnings: string[] = [];
    const functions = extractPythonFunctions(pythonFile(`
def passthrough(value):
    return render(value)

if (
`), {
      addWarning: (warning) => warnings.push(warning),
    });

    assert.equal(functions.length, 1);
    assert.equal(functions[0]?.name, "passthrough");
    assert.match(warnings[0] ?? "", /could not parse/);
  });

  it("detects large Python functions with stable fingerprints and suggestions", async () => {
    const issues = await runDetector(pythonLargeFunctionDetector, {
      "src/service.py": `
def route_invoice(invoice):
    status = "review"
    if invoice.get("paid"):
        status = "paid"
    elif invoice.get("failed"):
        status = "failed"
    elif invoice.get("pending"):
        status = "pending"
    for line in invoice.get("lines", []):
        if line.get("blocked"):
            status = "blocked"
    return status
`,
    }, {
      thresholds: {
        "large-function.maxLines": 8,
        "large-function.maxBranches": 4,
      },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "python-large-function");
    assert.ok(issues[0]?.fingerprint);
    assert.match(issues[0]?.suggestion ?? "", /Split orchestration/);
    assert.match(issues[0]?.evidence?.[0] ?? "", /route_invoice:/);
  });

  it("detects complex Python control flow without counting comments or strings", async () => {
    const issues = await runDetector(pythonComplexControlFlowDetector, {
      "src/service.py": `
def classify_invoice(invoice):
    note = "if for while except case and or"
    # if for while except case and or
    if invoice.get("paid"):
        if invoice.get("late"):
            return "paid-late"
        elif invoice.get("vip"):
            return "paid-vip"
    for line in invoice.get("lines", []):
        if line.get("blocked"):
            return "blocked"
    return "review"
`,
    }, {
      thresholds: {
        "complex-control-flow.maxComplexity": 6,
        "complex-control-flow.maxDepth": 3,
      },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "python-complex-control-flow");
    assert.ok(issues[0]?.fingerprint);
    assert.match(issues[0]?.message ?? "", /complex Python control flow/);
    assert.match(issues[0]?.suggestion ?? "", /Extract decision tables/);
  });

  it("keeps Python complexity quiet for branch words in comments and strings", async () => {
    const issues = await runDetector(pythonComplexControlFlowDetector, {
      "src/service.py": `
def describe_policy():
    text = """if for while except case and or"""
    # if for while except case and or
    return text
`,
    }, {
      thresholds: {
        "complex-control-flow.maxComplexity": 2,
        "complex-control-flow.maxDepth": 1,
      },
    });

    assert.equal(issues.length, 0);
  });

  it("detects complexity rules for multiline Python function signatures", async () => {
    const files = {
      "src/service.py": `
def classify_invoice(
    invoice,
    account,
):
    if invoice.get("paid"):
        if account.get("active"):
            return "paid"
    for line in invoice.get("lines", []):
        if line.get("blocked"):
            return "blocked"
    return "review"
`,
    };

    const largeIssues = await runDetector(pythonLargeFunctionDetector, files, {
      thresholds: {
        "large-function.maxLines": 8,
        "large-function.maxBranches": 3,
      },
    });
    const controlFlowIssues = await runDetector(pythonComplexControlFlowDetector, files, {
      thresholds: {
        "complex-control-flow.maxComplexity": 5,
        "complex-control-flow.maxDepth": 3,
      },
    });

    assert.equal(largeIssues.length, 1);
    assert.equal(largeIssues[0]?.location?.startLine, 2);
    assert.equal(controlFlowIssues.length, 1);
    assert.equal(controlFlowIssues[0]?.location?.startLine, 2);
  });

  it("flags Flask modules with too many decorator-backed routes", async () => {
    const issues = await runDetector(pythonRouteSprawlDetector, {
      "src/routes/accounts.py": `
from flask import Blueprint

bp = Blueprint("accounts", __name__)

@bp.get("/accounts")
def list_accounts():
    return "ok"

@bp.post("/accounts")
def create_account():
    return "ok"

@bp.get("/accounts/<account_id>")
def show_account(account_id):
    return "ok"

@bp.patch("/accounts/<account_id>")
def update_account(account_id):
    return "ok"

@bp.delete("/accounts/<account_id>")
def delete_account(account_id):
    return "ok"

@bp.post("/accounts/<account_id>/archive")
def archive_account(account_id):
    return "ok"

@bp.post("/accounts/<account_id>/restore")
def restore_account(account_id):
    return "ok"

@bp.get("/accounts/<account_id>/events")
def list_events(account_id):
    return "ok"

@bp.post("/accounts/<account_id>/events")
def create_event(account_id):
    return "ok"
`,
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "python-route-sprawl");
    assert.match(issues[0]?.message ?? "", /registers 9 Python web routes/);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("GET /accounts")));
  });

  it("counts Flask route decorators with configured methods", async () => {
    const issues = await runDetector(pythonRouteSprawlDetector, {
      "src/routes/sessions.py": `
from flask import Flask

app = Flask(__name__)

@app.route(rule="/sessions", methods=["GET", "POST"])
def sessions():
    return "ok"

@app.route(rule="/sessions/<id>", methods=["DELETE"])
def session_detail(id):
    return "ok"
`,
    }, {
      thresholds: { "python-route-sprawl.maxRoutes": 2 },
    });

    assert.equal(issues.length, 1);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("GET,POST /sessions")));
  });

  it("recognizes named Flask Blueprint receivers without counting cache decorators", async () => {
    const issues = await runDetector(pythonRouteSprawlDetector, {
      "src/routes/billing.py": `
from flask import Blueprint

accounts = Blueprint("accounts", __name__)

@accounts.get("/accounts")
def accounts_index():
    return "ok"

@cache.get("/accounts")
def cached_accounts():
    return []
`,
    }, {
      thresholds: { "python-route-sprawl.maxRoutes": 1 },
    });

    assert.equal(issues.length, 1);
    assert.deepEqual(issues[0]?.evidence, ["GET /accounts at line 6"]);
  });

  it("does not count unbound api or router clients as Flask route receivers", async () => {
    const issues = await runDetector(pythonRouteSprawlDetector, {
      "src/routes/tasks.py": `
from flask import Flask

app = Flask(__name__)

@api.get("/remote/accounts")
def remote_accounts():
    return []

@router.post("/jobs")
def enqueue_job():
    return "ok"
`,
    }, {
      thresholds: { "python-route-sprawl.maxRoutes": 1 },
    });

    assert.equal(issues.length, 0);
  });

  it("does not count Flask route examples inside docstrings", async () => {
    const issues = await runDetector(pythonRouteSprawlDetector, {
      "src/routes/docs.py": `
from flask import Blueprint

bp = Blueprint("docs", __name__)

def document_routes():
    """
    Examples:
        @bp.get("/accounts")
        def list_accounts():
            return "ok"

        @bp.post("/accounts")
        def create_account():
            return "ok"
    """
    return "docs"
`,
    }, {
      thresholds: { "python-route-sprawl.maxRoutes": 1 },
    });

    assert.equal(issues.length, 0);
  });

  it("keeps small Python web route modules quiet", async () => {
    const issues = await runDetector(pythonRouteSprawlDetector, {
      "src/routes/health.py": `
from flask import Flask

app = Flask(__name__)

@app.get("/health")
def health():
    return "ok"

@cache.get("/health")
def recent_invoices():
    return []
`,
    });

    assert.equal(issues.length, 0);
  });

  it("counts conservative Django URLConf route registrations", async () => {
    const issues = await runDetector(pythonRouteSprawlDetector, {
      "src/urls.py": `
from django.urls import path, re_path
from . import views

urlpatterns = [
    path("accounts/", views.accounts),
    path("accounts/create/", views.create_account),
    path("accounts/<uuid:account_id>/", views.account_detail),
    re_path(r"^accounts/(?P<account_id>[^/]+)/archive/$", views.archive_account),
]
`,
    }, {
      thresholds: { "python-route-sprawl.maxRoutes": 4 },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "python-route-sprawl");
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("DJANGO_PATH accounts/")));
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("DJANGO_RE_PATH ^accounts/")));
  });

  it("does not count Django URL examples inside multiline strings", async () => {
    const issues = await runDetector(pythonRouteSprawlDetector, {
      "src/urls.py": `
from django.urls import path

urlpatterns = []

ROUTE_DOCS = """
path("accounts/", views.accounts),
path("accounts/create/", views.create_account),
"""
`,
    }, {
      thresholds: { "python-route-sprawl.maxRoutes": 1 },
    });

    assert.equal(issues.length, 0);
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
