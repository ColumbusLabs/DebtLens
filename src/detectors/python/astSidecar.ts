import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { SourceFileInfo } from "../../core/types.js";

export interface PythonDecoratorInfo {
  text: string;
  line: number;
  endLine?: number;
}

export interface PythonImportInfo {
  kind: "import" | "from";
  module?: string;
  names: string[];
  line: number;
}

export interface PythonCommentInfo {
  text: string;
  line: number;
}

export interface PythonClassInfo {
  name: string;
  qualifiedName: string;
  decorators: PythonDecoratorInfo[];
  startLine: number;
  endLine: number;
}

export interface PythonAstFunctionInfo {
  name: string;
  qualifiedName: string;
  params: string[];
  isAsync: boolean;
  kind: "function" | "method" | "nested-function";
  parentClass?: string;
  decorators: PythonDecoratorInfo[];
  startLine: number;
  endLine: number;
  bodyStartLine?: number;
}

export interface PythonAstModuleInfo {
  functions: PythonAstFunctionInfo[];
  classes: PythonClassInfo[];
  imports: PythonImportInfo[];
  comments: PythonCommentInfo[];
}

export interface PythonAstSidecarOptions {
  addWarning?: (warning: string) => void;
  pythonCommands?: readonly string[];
}

interface PythonAstSidecarCacheEntry {
  module?: PythonAstModuleInfo;
  warning?: string;
}

interface PythonSidecarResponse {
  ok: boolean;
  error?: string;
  invalidJson?: boolean;
  line?: number;
  functions?: PythonAstFunctionInfo[];
  classes?: PythonClassInfo[];
  imports?: PythonImportInfo[];
  comments?: PythonCommentInfo[];
}

const DEFAULT_PYTHON_COMMANDS = ["python3", "python"] as const;
const astSidecarCache = new Map<string, PythonAstSidecarCacheEntry>();
const unavailableRuntimeWarnings = new Map<string, string>();

export function parsePythonAstSidecar(
  file: SourceFileInfo,
  options: PythonAstSidecarOptions = {},
): PythonAstModuleInfo | undefined {
  const commands = options.pythonCommands?.length ? [...options.pythonCommands] : [...DEFAULT_PYTHON_COMMANDS];
  const commandsKey = commands.join(",");
  const runtimeWarning = unavailableRuntimeWarnings.get(commandsKey);
  if (runtimeWarning) {
    options.addWarning?.(runtimeWarning);
    return undefined;
  }

  const cacheKey = buildCacheKey(file, commandsKey);
  const cached = astSidecarCache.get(cacheKey);
  if (cached) {
    if (cached.warning) options.addWarning?.(cached.warning);
    return cached.module;
  }

  const entry = runPythonAstSidecar(file, commands, commandsKey);
  astSidecarCache.set(cacheKey, entry);
  if (entry.warning) options.addWarning?.(entry.warning);
  return entry.module;
}

function runPythonAstSidecar(
  file: SourceFileInfo,
  commands: string[],
  commandsKey: string,
): PythonAstSidecarCacheEntry {
  const payload = JSON.stringify({
    filename: file.relativePath,
    source: file.content,
  });
  const missingCommands: string[] = [];
  const failedCommands: string[] = [];

  for (const command of commands) {
    const result = spawnSync(command, ["-c", PYTHON_AST_SIDECAR_SCRIPT], {
      input: payload,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 5000,
    });

    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        missingCommands.push(command);
        continue;
      }
      failedCommands.push(`${command}: ${result.error.message}`);
      continue;
    }

    if (result.status !== 0) {
      const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
      failedCommands.push(`${command}: ${detail}`);
      continue;
    }

    const response = parseSidecarResponse(result.stdout, file.relativePath);
    if (response.invalidJson) {
      failedCommands.push(`${command}: ${response.error ?? "invalid sidecar JSON"}`);
      continue;
    }
    if (!response.ok) {
      const line = response.line ? ` at line ${response.line}` : "";
      return {
        warning: `Python AST sidecar could not parse ${file.relativePath}${line}: ${response.error ?? "unknown parse error"}; falling back to text parsing.`,
      };
    }

    return {
      module: {
        functions: response.functions ?? [],
        classes: response.classes ?? [],
        imports: response.imports ?? [],
        comments: response.comments ?? [],
      },
    };
  }

  const warning = buildRuntimeWarning(file.relativePath, commands, missingCommands, failedCommands);
  if (failedCommands.length === 0) {
    unavailableRuntimeWarnings.set(commandsKey, warning);
  }
  return { warning };
}

function parseSidecarResponse(stdout: string, relativePath: string): PythonSidecarResponse {
  try {
    return JSON.parse(stdout) as PythonSidecarResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      invalidJson: true,
      error: `invalid sidecar JSON for ${relativePath}: ${message}`,
    };
  }
}

function buildRuntimeWarning(
  relativePath: string,
  commands: string[],
  missingCommands: string[],
  failedCommands: string[],
): string {
  if (failedCommands.length === 0) {
    const commandList = missingCommands.length ? missingCommands.join(", ") : commands.join(", ");
    return `Python AST sidecar unavailable because none of these commands could be started: ${commandList}; falling back to text parsing.`;
  }

  const missingDetail = missingCommands.length ? ` missing commands: ${missingCommands.join(", ")};` : "";
  return `Python AST sidecar failed for ${relativePath}:${missingDetail} ${failedCommands.join("; ")}; falling back to text parsing.`;
}

function buildCacheKey(file: SourceFileInfo, commandsKey: string): string {
  const hash = createHash("sha256").update(file.content).digest("hex");
  return `${commandsKey}\0${file.absolutePath}\0${hash}`;
}

const PYTHON_AST_SIDECAR_SCRIPT = String.raw`
import ast
import io
import json
import sys
import tokenize

payload = json.load(sys.stdin)
source = payload.get("source", "")
filename = payload.get("filename") or "<memory>"

def line_of(node):
    return int(getattr(node, "lineno", 1) or 1)

def end_line_of(node):
    return int(getattr(node, "end_lineno", getattr(node, "lineno", 1)) or line_of(node))

def source_segment(node):
    text = ast.get_source_segment(source, node)
    if text:
        return " ".join(text.strip().split())
    if hasattr(ast, "unparse"):
        try:
            return ast.unparse(node)
        except Exception:
            return "<decorator>"
    return "<decorator>"

def decorators_for(node):
    return [
        {
            "text": source_segment(decorator),
            "line": line_of(decorator),
            "endLine": end_line_of(decorator),
        }
        for decorator in getattr(node, "decorator_list", [])
    ]

def args_for(node):
    args = []
    node_args = node.args
    for arg in getattr(node_args, "posonlyargs", []):
        args.append(arg.arg)
    for arg in node_args.args:
        args.append(arg.arg)
    if node_args.vararg:
        args.append(node_args.vararg.arg)
    for arg in node_args.kwonlyargs:
        args.append(arg.arg)
    if node_args.kwarg:
        args.append(node_args.kwarg.arg)
    return args

def import_module_name(node):
    if not isinstance(node, ast.ImportFrom):
        return None
    prefix = "." * int(getattr(node, "level", 0) or 0)
    return prefix + (node.module or "")

try:
    tree = ast.parse(source, filename=filename, type_comments=True)
except SyntaxError as exc:
    print(json.dumps({
        "ok": False,
        "error": "SyntaxError: " + (exc.msg or "invalid syntax"),
        "line": exc.lineno,
    }, separators=(",", ":")))
    raise SystemExit(0)

functions = []
classes = []
imports = []
comments = []
qual_stack = []
class_stack = []
function_depth = 0

try:
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type == tokenize.COMMENT:
            comments.append({
                "text": token.string,
                "line": int(token.start[0]),
            })
except tokenize.TokenError:
    comments = []

class Collector(ast.NodeVisitor):
    def visit_Import(self, node):
        imports.append({
            "kind": "import",
            "names": [
                alias.name + ((" as " + alias.asname) if alias.asname else "")
                for alias in node.names
            ],
            "line": line_of(node),
        })

    def visit_ImportFrom(self, node):
        imports.append({
            "kind": "from",
            "module": import_module_name(node),
            "names": [
                alias.name + ((" as " + alias.asname) if alias.asname else "")
                for alias in node.names
            ],
            "line": line_of(node),
        })

    def visit_ClassDef(self, node):
        qualified = ".".join(qual_stack + [node.name])
        classes.append({
            "name": node.name,
            "qualifiedName": qualified,
            "decorators": decorators_for(node),
            "startLine": line_of(node),
            "endLine": end_line_of(node),
        })
        qual_stack.append(node.name)
        class_stack.append(node.name)
        self.generic_visit(node)
        class_stack.pop()
        qual_stack.pop()

    def visit_FunctionDef(self, node):
        self._visit_function(node, False)

    def visit_AsyncFunctionDef(self, node):
        self._visit_function(node, True)

    def _visit_function(self, node, is_async):
        global function_depth
        qualified = ".".join(qual_stack + [node.name])
        parent_class = class_stack[-1] if class_stack else None
        if function_depth > 0:
            kind = "nested-function"
        elif parent_class:
            kind = "method"
        else:
            kind = "function"
        body_start = min((line_of(child) for child in node.body), default=None)
        record = {
            "name": node.name,
            "qualifiedName": qualified,
            "params": args_for(node),
            "isAsync": bool(is_async),
            "kind": kind,
            "decorators": decorators_for(node),
            "startLine": line_of(node),
            "endLine": end_line_of(node),
        }
        if parent_class:
            record["parentClass"] = parent_class
        if body_start:
            record["bodyStartLine"] = body_start
        functions.append(record)

        qual_stack.append(node.name)
        function_depth += 1
        self.generic_visit(node)
        function_depth -= 1
        qual_stack.pop()

Collector().visit(tree)
print(json.dumps({
    "ok": True,
    "functions": functions,
    "classes": classes,
    "imports": imports,
    "comments": comments,
}, separators=(",", ":")))
`;
