import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = join(repoRoot, "scripts", "post-pr-comment.mjs");
const markerBody = "<!-- debtlens-report -->\n## DebtLens findings\n";

interface RequestRecord {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  body: string;
}

interface ScriptResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

describe("post-pr-comment script", () => {
  it("updates an existing DebtLens comment found after the first page", async () => {
    const requests: RequestRecord[] = [];
    const result = await withMockGitHub(requests, async (apiUrl) => runPostComment(apiUrl), (request, response, body) => {
      const url = new URL(request.url ?? "", "http://localhost");
      if (request.method === "GET" && url.searchParams.get("page") === "1") {
        return json(response, Array.from({ length: 100 }, (_, index) => ({ id: index + 1, body: "ordinary comment" })));
      }
      if (request.method === "GET" && url.searchParams.get("page") === "2") {
        return json(response, [{ id: 424, body: markerBody }]);
      }
      if (request.method === "PATCH" && url.pathname === "/repos/ColumbusLabs/DebtLens/issues/comments/424") {
        return json(response, { ok: true });
      }
      return json(response, { error: "unexpected" }, 500);
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /updated existing pull request comment/);
    assert.equal(requests.filter((request) => request.method === "GET").length, 2);
    const patch = requests.find((request) => request.method === "PATCH");
    assert.ok(patch);
    assert.match(patch.body, /DebtLens findings/);
  });

  it("creates a comment when no existing marker is found", async () => {
    const requests: RequestRecord[] = [];
    const result = await withMockGitHub(requests, async (apiUrl) => runPostComment(apiUrl), (request, response) => {
      if (request.method === "GET") return json(response, []);
      if (request.method === "POST" && request.url?.includes("/issues/7/comments")) {
        return json(response, { id: 12 }, 201);
      }
      return json(response, { error: "unexpected" }, 500);
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /created pull request comment/);
    assert.ok(requests.some((request) => request.method === "POST"));
  });

  it("warns without failing when comment permissions are missing by default", async () => {
    const requests: RequestRecord[] = [];
    const result = await withMockGitHub(requests, async (apiUrl) => runPostComment(apiUrl), (_request, response) =>
      json(response, { message: "Resource not accessible by integration" }, 403));

    assert.equal(result.status, 0);
    assert.match(result.stderr, /DebtLens warning: Failed to list PR comments: 403/);
    assert.match(result.stderr, /comment-fail-on-error: true/);
  });

  it("fails when comment-fail-on-error is enabled", async () => {
    const requests: RequestRecord[] = [];
    const result = await withMockGitHub(requests, async (apiUrl) => runPostComment(apiUrl, {
      DEBTLENS_COMMENT_FAIL_ON_ERROR: "true",
    }), (_request, response) => json(response, { message: "forbidden" }, 403));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Failed to list PR comments: 403/);
  });
});

async function withMockGitHub(
  requests: RequestRecord[],
  run: (apiUrl: string) => Promise<ScriptResult>,
  handler: (request: IncomingMessage, response: ServerResponse, body: string) => void,
): Promise<ScriptResult> {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const url = new URL(request.url ?? "", "http://localhost");
      requests.push({
        method: request.method ?? "GET",
        pathname: url.pathname,
        searchParams: url.searchParams,
        body,
      });
      handler(request, response, body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function runPostComment(apiUrl: string, env: Record<string, string> = {}): Promise<ScriptResult> {
  const dir = mkdtempSync(join(tmpdir(), "debtlens-post-comment-"));
  try {
    const eventPath = join(dir, "event.json");
    const reportPath = join(dir, "comment.md");
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7 } }), "utf8");
    writeFileSync(reportPath, markerBody, "utf8");

    return await new Promise((resolve) => {
      const child = spawn(process.execPath, [scriptPath, reportPath], {
        cwd: repoRoot,
        env: {
          ...process.env,
          GITHUB_TOKEN: "test-token",
          GITHUB_REPOSITORY: "ColumbusLabs/DebtLens",
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_API_URL: apiUrl,
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("close", (status) => {
        resolve({ status, stdout, stderr });
      });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function json(response: ServerResponse, payload: unknown, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}
