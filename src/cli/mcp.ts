import { resolve } from "node:path";
import { packageVersion } from "../utils/packageInfo.js";
import { spawnCliSync } from "../utils/spawn.js";
import { buildDoctorArgv, buildScanArgv } from "./argv.js";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

export function runMcpServer(entrypoint = process.argv[1], execArgv = process.execArgv): void {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) handleLine(line, entrypoint, execArgv);
      newline = buffer.indexOf("\n");
    }
  });
}

function handleLine(line: string, entrypoint: string, execArgv: string[]): void {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    writeResponse(null, undefined, { code: -32700, message: "Parse error" });
    return;
  }

  if (request.method?.startsWith("notifications/")) return;

  if (request.method === "initialize") {
    writeResponse(request.id, {
      protocolVersion: "2024-11-05",
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
    const result = callTool(toolName, request.params?.arguments ?? {}, entrypoint, execArgv);
    writeResponse(request.id, result);
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
          rules: { type: "string" },
          minSeverity: { type: "string" },
          format: { type: "string" },
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
  ];
}

function callTool(name: string, args: Record<string, unknown>, entrypoint: string, execArgv: string[]): Record<string, unknown> {
  const cliArgs = toolToCliArgs(name, args);
  if (!cliArgs) {
    return { isError: true, content: [{ type: "text", text: `Unknown tool ${name}` }] };
  }

  const cwd = typeof args.cwd === "string" && args.cwd.length > 0 ? resolve(args.cwd) : undefined;
  const result = spawnCliSync(cliArgs, { cwd, entrypoint, execArgv });
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return {
    isError: Boolean(result.error) || (typeof result.status === "number" && result.status !== 0),
    content: [{ type: "text", text: text || result.error?.message || "" }],
  };
}

function toolToCliArgs(name: string, args: Record<string, unknown>): string[] | undefined {
  if (name === "scan") {
    return buildScanArgv(stringArg(args.target, "."), {
      ...args,
      format: args.format ?? "json",
    });
  }
  if (name === "doctor") {
    return buildDoctorArgv(stringArg(args.target, "."), args);
  }
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
