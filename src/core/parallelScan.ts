import { availableParallelism } from "node:os";
import type { ScanOptions } from "./types.js";

export function resolveConcurrency(options: ScanOptions): number {
  if (options.concurrency !== undefined) return Math.max(1, options.concurrency);
  return 1;
}

export function shouldUseWorkerPool(options: ScanOptions): boolean {
  return resolveConcurrency(options) > 1;
}

export function defaultConcurrency(): number {
  return Math.max(1, Math.min(availableParallelism(), 4));
}

export async function shardFiles<T>(items: T[], concurrency: number): Promise<T[][]> {
  const shards: T[][] = Array.from({ length: Math.max(1, concurrency) }, () => []);
  for (let index = 0; index < items.length; index += 1) {
    shards[index % shards.length]?.push(items[index] as T);
  }
  return shards.filter((shard) => shard.length > 0);
}
