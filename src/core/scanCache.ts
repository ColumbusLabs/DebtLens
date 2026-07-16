import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, relative, resolve } from "node:path";
import type { Detector, ScanOptions, ScanResult } from "./types.js";
import { toCacheKeyPayload } from "./types.js";
import { packageVersion } from "../utils/packageInfo.js";
import { cleanupTempFile } from "../utils/tempFile.js";

const CACHE_VERSION = 3;
const MAX_ENTRIES = 20;

interface CacheFileEntry {
  path: string;
  hash: string;
}

interface CacheEntry {
  key: string;
  createdAt: string;
  files: CacheFileEntry[];
  result: ScanResult;
}

interface CacheStore {
  version: typeof CACHE_VERSION;
  entries: CacheEntry[];
}

export interface FileSnapshot {
  absolutePath: string;
  /** Checkout-root-independent identity persisted in shareable caches. */
  cacheIdentity?: string;
  content: string;
  hash: string;
}

export function getScanCachePath(options: ScanOptions): string {
  if (options.cacheDir) return resolve(options.cwd, options.cacheDir, "cache.json");
  return resolve(options.cwd, options.cachePath ?? ".debtlens/cache.json");
}

export function readCachedScan(cachePath: string, key: string, files: FileSnapshot[], currentTarget?: string): ScanResult | undefined {
  const store = readCacheStore(cachePath);
  const entry = store.entries.find((candidate) => candidate.key === key);
  if (!entry || !sameFiles(entry.files, files)) return undefined;
  const result = structuredClone(entry.result);
  if (currentTarget) result.options.target = currentTarget;
  return result;
}

export function writeCachedScan(cachePath: string, key: string, files: FileSnapshot[], result: ScanResult): void {
  const store = readCacheStore(cachePath);
  const portableResult = structuredClone(result);
  portableResult.options.target = ".";
  if (portableResult.summary.performance?.cache) {
    portableResult.summary.performance.cache.path = ".";
  }
  const nextEntry: CacheEntry = {
    key,
    createdAt: new Date().toISOString(),
    files: files.map((file) => ({ path: file.cacheIdentity ?? file.absolutePath, hash: file.hash })),
    result: portableResult,
  };
  const entries = [nextEntry, ...store.entries.filter((entry) => entry.key !== key)].slice(0, MAX_ENTRIES);
  mkdirSync(dirname(cachePath), { recursive: true });
  const payload = `${JSON.stringify({ version: CACHE_VERSION, entries }, null, 2)}\n`;
  const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, payload, "utf8");
    renameSync(tempPath, cachePath);
  } catch (error) {
    cleanupTempFile(tempPath, "cache");
    throw error;
  }
}

export function buildScanCacheKey(
  options: ScanOptions,
  detectors: Detector[],
  files: FileSnapshot[] = [],
  scannerVersion = packageVersion,
): string {
  const payload = toCacheKeyPayload(CACHE_VERSION, scannerVersion, options, detectors);
  return hashJson({
    ...payload,
    target: portablePath(options.cwd, options.target),
    changedFiles: options.changedFiles?.map((file) => portablePath(options.cwd, file)).sort(),
    files: files
      .map((file) => ({ path: file.cacheIdentity ?? portablePath(options.target, file.absolutePath), hash: file.hash }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  });
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function readCacheStore(cachePath: string): CacheStore {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as Partial<CacheStore>;
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) {
      return { version: CACHE_VERSION, entries: [] };
    }
    return { version: CACHE_VERSION, entries: parsed.entries as CacheEntry[] };
  } catch {
    return { version: CACHE_VERSION, entries: [] };
  }
}

function sameFiles(cached: CacheFileEntry[], current: FileSnapshot[]): boolean {
  if (cached.length !== current.length) return false;
  const byPath = new Map(cached.map((file) => [file.path, file.hash]));
  return current.every((file) => byPath.get(file.cacheIdentity ?? file.absolutePath) === file.hash);
}

function portablePath(root: string, path: string): string {
  const portable = relative(resolve(root), resolve(path)).replaceAll("\\", "/");
  return portable || ".";
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
