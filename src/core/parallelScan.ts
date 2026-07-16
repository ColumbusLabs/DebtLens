import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { DebtIssue, Detector, ScanOptions } from "./types.js";
import type { FileSnapshot } from "./scanCache.js";

export interface WorkerDetectorResult {
  detectorId: string;
  issues: DebtIssue[];
  elapsedMs: number;
  warnings: string[];
}

interface WorkerSuccessMessage {
  ok: true;
  results: WorkerDetectorResult[];
}

interface WorkerFailureMessage {
  ok: false;
  error: string;
}

type WorkerMessage = WorkerSuccessMessage | WorkerFailureMessage;

// These rules depend on repository-wide counts, graphs, duplicates, imports,
// or paired instruction surfaces. They must never run independently on file
// shards; scan.ts runs them once against the complete in-process context and
// merges them with worker results in detector registry order.
const CROSS_FILE_DETECTOR_IDS = new Set([
  "ai-instruction-contradiction",
  "ai-instruction-duplication",
  "config-drift",
  "duplicate-logic",
  "duplicated-literal",
  "import-cycle",
  "kotlin-duplicate-logic",
  "python-duplicate-logic",
  "ruby-duplicate-logic",
  "story-only-component",
  "stale-feature-flag",
  "svelte-duplicate-logic",
  "swift-duplicate-logic",
  "test-duplication",
  "vue-duplicate-logic",
]);

export function isCrossFileDetector(detector: Detector): boolean {
  return CROSS_FILE_DETECTOR_IDS.has(detector.id);
}

export function resolveConcurrency(options: ScanOptions): number {
  if (options.concurrency !== undefined) return Math.max(1, options.concurrency);
  return options.parallel ? defaultConcurrency() : 1;
}

export function shouldUseWorkerPool(options: ScanOptions): boolean {
  return resolveConcurrency(options) > 1;
}

export function defaultConcurrency(): number {
  return Math.max(1, Math.min(availableParallelism(), 4));
}

export function shardFiles<T>(items: T[], concurrency: number): T[][] {
  return shardRoundRobin(items, concurrency);
}

/**
 * Run file-local built-in detectors in real worker threads. Callers must keep
 * cross-file detectors on the coordinator, where they retain a complete
 * repository view and can be merged after the shard phase.
 */
export async function runBuiltinDetectorsInWorkers(input: {
  detectors: Detector[];
  snapshots: FileSnapshot[];
  options: ScanOptions;
  concurrency: number;
}): Promise<WorkerDetectorResult[]> {
  if (input.detectors.length === 0) return [];
  if (input.snapshots.length === 0) {
    return input.detectors.map((detector) => ({
      detectorId: detector.id,
      issues: [],
      elapsedMs: 0,
      warnings: [],
    }));
  }

  const workerCount = Math.min(Math.max(1, input.concurrency), input.snapshots.length);
  const snapshotShards = shardRoundRobin(input.snapshots, workerCount);
  const workerUrl = resolveWorkerUrl();
  const { pluginDetectors: _pluginDetectors, fileContents: _fileContents, ...workerOptions } = input.options;

  const detectorIds = input.detectors.map((detector) => detector.id);
  const shardResults = await Promise.all(snapshotShards.map((snapshots) => runWorker(workerUrl, {
    detectorIds,
    snapshots,
    options: workerOptions,
  })));
  const byDetectorId = new Map<string, WorkerDetectorResult>();
  for (const result of shardResults.flat()) {
    const aggregate = byDetectorId.get(result.detectorId);
    if (!aggregate) {
      byDetectorId.set(result.detectorId, { ...result, issues: [...result.issues], warnings: [...result.warnings] });
      continue;
    }
    aggregate.issues.push(...result.issues);
    aggregate.elapsedMs += result.elapsedMs;
    for (const warning of result.warnings) {
      if (!aggregate.warnings.includes(warning)) aggregate.warnings.push(warning);
    }
  }

  return input.detectors.map((detector) => {
    const result = byDetectorId.get(detector.id);
    if (!result) throw new Error(`Parallel scan worker did not return detector "${detector.id}".`);
    return result;
  });
}

function shardRoundRobin<T>(items: T[], concurrency: number): T[][] {
  const shards: T[][] = Array.from({ length: Math.max(1, concurrency) }, () => []);
  for (let index = 0; index < items.length; index += 1) {
    shards[index % shards.length]?.push(items[index] as T);
  }
  return shards.filter((shard) => shard.length > 0);
}

function resolveWorkerUrl(): URL {
  const javascriptUrl = new URL("./parallelScanWorker.js", import.meta.url);
  if (existsSync(fileURLToPath(javascriptUrl))) return javascriptUrl;
  return new URL("./parallelScanWorkerSource.js", import.meta.url);
}

function runWorker(workerUrl: URL, workerData: unknown): Promise<WorkerDetectorResult[]> {
  return new Promise((resolve, reject) => {
    const sourceWorker = workerUrl.pathname.endsWith("parallelScanWorkerSource.js");
    const workerPayload = sourceWorker
      ? {
          ...(workerData as Record<string, unknown>),
          sourceWorkerUrl: new URL("./parallelScanWorker.ts", import.meta.url).href,
        }
      : workerData;
    const worker = new Worker(workerUrl, { workerData: workerPayload });
    let settled = false;

    worker.once("message", (message: WorkerMessage) => {
      settled = true;
      if (message.ok) resolve(message.results);
      else reject(new Error(message.error));
    });
    worker.once("error", (error) => {
      settled = true;
      reject(error);
    });
    worker.once("exit", (code) => {
      if (!settled && code !== 0) reject(new Error(`Parallel scan worker exited with code ${code}.`));
      else if (!settled) reject(new Error("Parallel scan worker exited without returning results."));
    });
  });
}
