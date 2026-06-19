import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compareScanResults } from "../../core/scanComparison.js";
import { parseSeverity } from "../../core/severity.js";
import { spawnCliSync } from "../../utils/spawn.js";
import { packageVersion } from "../../utils/packageInfo.js";
import { runAdopt } from "../adopt.js";
import { runBaselineMaintenanceCommand } from "../baselineMaintenance.js";
import { parseAdoptFormat, parseCommaList, parseCompareFormat, parseFormat, parseRuleList, parseThresholds } from "../parse.js";
import { runSuppress } from "../suppress.js";
import { renderCompareReport } from "../../reporters/compareReporter.js";
import { runDoctorForMcp } from "./doctor.js";
import { runScanForMcp } from "./scan.js";

const MCP_PROTOCOL_2024 = "2024-11-05";
const MCP_PROTOCOL_2025 = "2025-06-18";

type SupportedMcpProtocolVersion = typeof MCP_PROTOCOL_2024 | typeof MCP_PROTOCOL_2025;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    protocolVersion?: string;
  };
}

interface McpSessionState {
  protocolVersion: SupportedMcpProtocolVersion;
}

export function registerMcpCommand(program: Command): void {
  program.command("mcp")
    .description("Run the DebtLens MCP stdio server.")
    .action(() => {
      runMcpServer();
    });
}

export function runMcpServer(entrypoint = process.argv[1], execArgv = process.execArgv): void {
  let buffer = "";
  const state: McpSessionState = { protocolVersion: MCP_PROTOCOL_2024 };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) void handleLine(line, entrypoint, execArgv, state);
      newline = buffer.indexOf("\n");
    }
  });
}

async function handleLine(
  line: string,
  entrypoint: string,
  execArgv: string[],
  state: McpSessionState,
): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    writeResponse(null, undefined, { code: -32700, message: "Parse error" });
    return;
  }

  if (request.method?.startsWith("notifications/")) return;

  if (request.method === "initialize") {
    state.protocolVersion = request.params?.protocolVersion === MCP_PROTOCOL_2025
      ? MCP_PROTOCOL_2025
      : MCP_PROTOCOL_2024;
    writeResponse(request.id, {
      protocolVersion: state.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "debtlens", version: packageVersion },
    });
    return;
  }

  if (request.method === "tools/list") {
    writeResponse(request.id, { tools: tools() });
    return;
  }

  if (request.method === "tools/call") {
    const toolName = request.params?.name;
    if (!toolName) {
      writeResponse(request.id, undefined, { code: -32602, message: "Missing tool name" });
      return;
    }
    try {
      const result = await callTool(toolName, request.params?.arguments ?? {}, entrypoint, execArgv, state.protocolVersion);
      writeResponse(request.id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeResponse(request.id, undefined, { code: -32603, message });
    }
    return;
  }

  writeResponse(request.id, undefined, { code: -32601, message: `Unknown method ${request.method ?? ""}` });
}

function tools(): Array<Record<string, unknown>> {
  return [
    {
      name: "scan",
      description: "Run `debtlens scan` and return the report text.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          cwd: { type: "string" },
          pack: { type: "string" },
          package: { type: "string" },
          rules: { type: "string" },
          minSeverity: { type: "string" },
          format: { type: "string" },
          config: { type: "string" },
          changed: { type: "string" },
          staged: { type: "boolean" },
          diffBase: { type: "string" },
          baseline: { type: "string" },
          auditSuppressions: { type: "boolean" },
          hotspots: { oneOf: [{ type: "boolean" }, { type: "number" }, { type: "string" }] },
          churnDays: { oneOf: [{ type: "number" }, { type: "string" }] },
          churnRange: { type: "string" },
          ownership: { type: "boolean" },
          codeowners: { type: "string" },
        },
      },
    },
    {
      name: "doctor",
      description: "Run `debtlens doctor` for config and file-matching diagnostics.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          cwd: { type: "string" },
          pack: { type: "string" },
          package: { type: "string" },
        },
      },
    },
    {
      name: "rules",
      description: "List built-in DebtLens rules.",
      inputSchema: { type: "object", properties: { format: { type: "string" } } },
    },
    {
      name: "explain",
      description: "Explain one DebtLens rule.",
      inputSchema: { type: "object", required: ["rule"], properties: { rule: { type: "string" } } },
    },
    {
      name: "adopt",
      description: "Run a read-only adoption dry run and return agent-planning data.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          cwd: { type: "string" },
          pack: { type: "string" },
          package: { type: "string" },
          rules: { type: "string" },
          minSeverity: { type: "string" },
          format: { type: "string" },
          config: { type: "string" },
          include: { type: "string" },
          exclude: { type: "string" },
          threshold: { type: "string" },
        },
      },
    },
    {
      name: "compare",
      description: "Compare two ScanResult JSON reports without rescanning.",
      inputSchema: {
        type: "object",
        required: ["previous", "current"],
        properties: {
          previous: { type: "string" },
          current: { type: "string" },
          cwd: { type: "string" },
          format: { type: "string" },
        },
      },
    },
    {
      name: "suppress",
      description: "Generate an auditable inline suppression directive.",
      inputSchema: {
        type: "object",
        required: ["rule", "reason"],
        properties: {
          rule: { type: "string" },
          reason: { type: "string" },
          file: { type: "boolean" },
        },
      },
    },
    {
      name: "baseline_diff",
      description: "Preview baseline drift without writing files.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          cwd: { type: "string" },
          baseline: { type: "string" },
          pack: { type: "string" },
          package: { type: "string" },
          rules: { type: "string" },
          minSeverity: { type: "string" },
          config: { type: "string" },
          include: { type: "string" },
          exclude: { type: "string" },
          threshold: { type: "string" },
        },
      },
    },
    {
      name: "baseline_prune_preview",
      description: "Preview a baseline prune without writing files.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          cwd: { type: "string" },
          baseline: { type: "string" },
          pack: { type: "string" },
          package: { type: "string" },
          rules: { type: "string" },
          minSeverity: { type: "string" },
          config: { type: "string" },
          include: { type: "string" },
          exclude: { type: "string" },
          threshold: { type: "string" },
        },
      },
    },
  ];
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  entrypoint: string,
  execArgv: string[],
  protocolVersion: SupportedMcpProtocolVersion,
): Promise<Record<string, unknown>> {
  if (name === "scan") {
    const cwd = typeof args.cwd === "string" && args.cwd.length > 0 ? resolve(args.cwd) : process.cwd();
    const format = typeof args.format === "string" ? parseFormat(args.format) : "json";
    const result = await runScanForMcp(stringArg(args.target, "."), {
      baseline: args.baseline,
      changed: args.changed,
      config: args.config,
      cwd,
      diffBase: args.diffBase,
      minSeverity: args.minSeverity,
      pack: args.pack,
      package: args.package,
      rules: args.rules,
      staged: args.staged,
      auditSuppressions: args.auditSuppressions,
      hotspots: args.hotspots,
      churnDays: args.churnDays,
      churnRange: args.churnRange,
      ownership: args.ownership,
      codeowners: args.codeowners,
    }, {
      format,
    });
    const text = format === "json"
      ? result.report.trim()
      : `${result.report}${result.stderr}`.trim();
    return {
      isError: result.exitCode !== 0,
      content: [{ type: "text", text }],
    };
  }

  if (name === "doctor") {
    const cwd = typeof args.cwd === "string" && args.cwd.length > 0 ? resolve(args.cwd) : process.cwd();
    const result = await runDoctorForMcp(stringArg(args.target, "."), {
      cwd,
      pack: args.pack,
      package: args.package,
    });
    return {
      isError: result.exitCode !== 0,
      content: [{ type: "text", text: result.text }],
    };
  }

  if (name === "adopt") {
    const cwd = typeof args.cwd === "string" && args.cwd.length > 0 ? resolve(args.cwd) : process.cwd();
    const result = await runAdopt({
      target: stringArg(args.target, "."),
      cwd,
      configPath: typeof args.config === "string" ? args.config : undefined,
      pack: typeof args.pack === "string" ? args.pack : undefined,
      packageName: typeof args.package === "string" ? args.package : undefined,
      format: typeof args.format === "string" ? parseAdoptFormat(args.format) : "markdown",
      writeConfig: false,
      writeBaseline: undefined,
      cliOptions: {
        cwd,
        include: parseCommaList(args.include as string | undefined),
        exclude: parseCommaList(args.exclude as string | undefined),
        rules: parseRuleList(args.rules as string | undefined),
        thresholds: parseThresholds(args.threshold as string | undefined),
        pack: typeof args.pack === "string" ? args.pack : undefined,
        minSeverity: args.minSeverity !== undefined
          ? parseSeverity(String(args.minSeverity), "low")
          : undefined,
      },
    });
    return textResult(result.text, false, protocolVersion, {
      summary: result.scan.summary,
      recommendedMinSeverity: result.recommendedMinSeverity,
      thresholdSuggestions: result.thresholdSuggestions,
      rolloutPlan: result.rolloutPlan,
      dryRun: true,
    });
  }

  if (name === "compare") {
    const cwd = typeof args.cwd === "string" && args.cwd.length > 0 ? resolve(args.cwd) : process.cwd();
    const format = typeof args.format === "string" ? parseCompareFormat(args.format) : "markdown";
    const previousPath = resolve(cwd, stringArg(args.previous, ""));
    const currentPath = resolve(cwd, stringArg(args.current, ""));
    const previous = JSON.parse(readFileSync(previousPath, "utf8"));
    const current = JSON.parse(readFileSync(currentPath, "utf8"));
    const comparison = compareScanResults(previous, current);
    return textResult(renderCompareReport(comparison, format).trim(), false, protocolVersion, comparison);
  }

  if (name === "suppress") {
    const directive = runSuppress({
      ruleId: stringArg(args.rule, ""),
      reason: stringArg(args.reason, ""),
      file: args.file === true,
    });
    const structured = describeSuppressionDirective(directive);
    return textResult(directive.trim(), false, protocolVersion, structured);
  }

  if (name === "baseline_diff" || name === "baseline_prune_preview") {
    const cwd = typeof args.cwd === "string" && args.cwd.length > 0 ? resolve(args.cwd) : process.cwd();
    const result = await runBaselineMaintenanceCommand(
      name === "baseline_diff" ? "diff" : "prune",
      stringArg(args.target, "."),
      baselinePreviewOptions(args, cwd),
    );
    const text = `${result.report}${result.stderr}`.trim();
    return textResult(text, result.exitCode !== 0, protocolVersion, JSON.parse(result.report));
  }

  const cliArgs = subprocessToolToCliArgs(name, args);
  if (!cliArgs) {
    return textResult(`Unknown tool ${name}`, true);
  }

  const cwd = typeof args.cwd === "string" && args.cwd.length > 0 ? resolve(args.cwd) : undefined;
  const result = spawnCliSync(cliArgs, { cwd, entrypoint, execArgv });
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return textResult(text || result.error?.message || "", Boolean(result.error) || (typeof result.status === "number" && result.status !== 0));
}

function subprocessToolToCliArgs(name: string, args: Record<string, unknown>): string[] | undefined {
  if (name === "rules") {
    const cli = ["rules"];
    if (typeof args.format === "string" && args.format.length > 0) {
      cli.push("--format", args.format);
    } else {
      cli.push("--format", "json");
    }
    return cli;
  }
  if (name === "explain") {
    return ["explain", stringArg(args.rule, "")];
  }
  return undefined;
}

function writeResponse(id: JsonRpcRequest["id"], result?: unknown, error?: { code: number; message: string }): void {
  if (id === undefined || id === null) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error } : { result }) })}\n`);
}

function stringArg(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function textResult(
  text: string,
  isError = false,
  protocolVersion: SupportedMcpProtocolVersion = MCP_PROTOCOL_2024,
  structuredContent?: unknown,
): Record<string, unknown> {
  return {
    isError,
    content: [{ type: "text", text }],
    ...(protocolVersion === MCP_PROTOCOL_2025 && structuredContent !== undefined ? { structuredContent } : {}),
  };
}

function baselinePreviewOptions(args: Record<string, unknown>, cwd: string): Record<string, unknown> {
  return {
    baseline: args.baseline,
    config: args.config,
    cwd,
    dryRun: true,
    exclude: args.exclude,
    format: "json",
    include: args.include,
    minSeverity: args.minSeverity,
    package: args.package,
    pack: args.pack,
    rules: args.rules,
    threshold: args.threshold,
  };
}

function describeSuppressionDirective(directive: string): Record<string, unknown> {
  const trimmed = directive.trim();
  const match = trimmed.match(/^\/\/ (debtlens-disable-(?:next-line|file)) ([^\s]+) -- (.*)$/);
  return {
    directive: trimmed,
    kind: match?.[1] === "debtlens-disable-file" ? "file" : "next-line",
    ruleId: match?.[2],
    reason: match?.[3],
  };
}
