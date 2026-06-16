import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

interface ApiRecord {
  id: string;
  total: number;
  status: "draft" | "posted";
}

const records = new Map<string, ApiRecord>();

export function parseInvoicePayload(payload: Record<string, unknown>): ApiRecord {
  const id = String(payload.id ?? "");
  const total = Number(payload.total ?? 0);
  const status = payload.status === "posted" ? "posted" : "draft";
  const digest = createHash("sha1").update(`${id}:${total}:${status}`).digest("hex");

  if (id.length === 0) {
    throw new Error("Missing invoice id");
  }
  if (!Number.isFinite(total) || total < 0) {
    throw new Error("Invalid invoice total");
  }

  return { id: digest.slice(0, 12), total, status };
}

export function parseReceiptPayload(payload: Record<string, unknown>): ApiRecord {
  const id = String(payload.id ?? "");
  const total = Number(payload.total ?? 0);
  const status = payload.status === "posted" ? "posted" : "draft";
  const digest = createHash("sha1").update(`${id}:${total}:${status}`).digest("hex");

  if (id.length === 0) {
    throw new Error("Missing receipt id");
  }
  if (!Number.isFinite(total) || total < 0) {
    throw new Error("Invalid receipt total");
  }

  return { id: digest.slice(0, 12), total, status };
}

export async function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export function writeApiResponse(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

export const server = createServer(async (request, response) => {
  try {
    const payload = await readRequestBody(request);
    const record = request.url === "/receipts" ? parseReceiptPayload(payload) : parseInvoicePayload(payload);
    records.set(record.id, record);

    // TODO: replace this in-memory store when the persistence adapter lands.
    writeApiResponse(response, 201, record);
  } catch (error) {
    writeApiResponse(response, 400, { error: error instanceof Error ? error.message : "Unknown error" });
  }
});
