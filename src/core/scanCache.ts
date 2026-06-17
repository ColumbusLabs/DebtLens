import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { Detector, ScanOptions, ScanResult } from "./types.js";
import { packageVersion } from "../utils/packageInfo.js";

const CACHE_VERSION = 1;
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
  content: string;
  hash: string;
}

export function getScanCachePath(options: ScanOptions): string {
  return resolve(options.cwd, options.cachePath ?? ".debtlens/cache.json");
}

export function readCachedScan(cachePath: string, key: string, files: FileSnapshot[]): ScanResult | undefined {
  const store = readCacheStore(cachePath);
  const entry = store.entries.find((candidate) => candidate.key === key);
  if (!entry || !sameFiles(entry.files, files)) return undefined;
  return structuredClone(entry.result);
}

export function writeCachedScan(cachePath: string, key: string, files: FileSnapshot[], result: ScanResult): void {
  const store = readCacheStore(cachePath);
  const nextEntry: CacheEntry = {
    key,
    createdAt: new Date().toISOString(),
    files: files.map((file) => ({ path: file.absolutePath, hash: file.hash })),
    result,
  };
  const entries = [nextEntry, ...store.entries.filter((entry) => entry.key !== key)].slice(0, MAX_ENTRIES);
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify({ version: CACHE_VERSION, entries }, null, 2)}\n`, "utf8");
}

export function buildScanCacheKey(options: ScanOptions, detectors: Detector[]): string {
  return hashJson({
    version: CACHE_VERSION,
    packageVersion,
    target: options.target,
    include: options.include,
    exclude: options.exclude,
    minSeverity: options.minSeverity,
    pack: options.pack,
    rules: options.rules,
    thresholds: options.thresholds,
    maxFiles: options.maxFiles,
    respectGitignore: options.respectGitignore,
    profile: options.profile,
    changedFiles: options.changedFiles,
    detectorIds: detectors.map((detector) => detector.id),
    ruleSeverities: options.ruleSeverities,
    ruleConfidenceFloors: options.ruleConfidenceFloors,
    vocabulary: options.vocabulary,
    namingDriftDisableBuiltInVocabulary: options.namingDriftDisableBuiltInVocabulary,
    propDrillingIgnoreComponents: options.propDrillingIgnoreComponents,
    todoCommentReplaceDefaults: options.todoCommentReplaceDefaults,
    todoCommentDisableDefaults: options.todoCommentDisableDefaults,
    todoCommentMarkers: options.todoCommentMarkers?.map((marker) => ({
      regex: String(marker.regex),
      severity: marker.severity,
      label: marker.label,
    })),
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
  return current.every((file) => byPath.get(file.absolutePath) === file.hash);
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
