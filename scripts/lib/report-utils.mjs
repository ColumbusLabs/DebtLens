import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export function parseAnnotationLimit(value, { defaultValue, max = Number.POSITIVE_INFINITY, name }) {
  if (!value) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    const expectation = Number.isFinite(max) ? `an integer from 0 to ${max}` : "a non-negative integer";
    throw new Error(`Invalid ${name} "${value}". Expected ${expectation}.`);
  }
  return parsed;
}

export function compareIssues(left, right) {
  const severityDelta = severityRank(right.severity) - severityRank(left.severity);
  if (severityDelta !== 0) return severityDelta;
  const confidenceDelta = Number(right.confidence ?? 0) - Number(left.confidence ?? 0);
  if (confidenceDelta !== 0) return confidenceDelta;
  const fileDelta = String(left.file ?? "").localeCompare(String(right.file ?? ""));
  if (fileDelta !== 0) return fileDelta;
  return Number(left.location?.startLine ?? 0) - Number(right.location?.startLine ?? 0);
}

export function severityRank(severity) {
  if (severity === "high") return 4;
  if (severity === "medium") return 3;
  if (severity === "low") return 2;
  return 1;
}

export function repoRelativeIssuePath(file, scanResult, options = {}) {
  const repoRoot = repoRootForTarget(scanResult.options?.target, options);
  const normalizedFile = normalizeSlashPath(String(file).replace(/^\.\//, ""));
  if (isAbsolute(normalizedFile)) {
    const relativePath = normalizeSlashPath(relative(repoRoot, normalizedFile));
    return relativePath && !relativePath.startsWith("..") ? relativePath : normalizedFile;
  }

  const targetPrefix = repoRelativeTargetPrefix(scanResult.options?.target, repoRoot);
  if (!targetPrefix || pathStartsWith(normalizedFile, targetPrefix)) {
    return normalizedFile;
  }
  return `${targetPrefix}/${normalizedFile.replace(/^\/+/, "")}`;
}

export function repoRelativeTargetPrefix(target, repoRoot) {
  if (!target || target === ".") return "";
  const targetPath = isAbsolute(target) ? target : resolve(repoRoot, target);
  const issueRoot = safeIsFile(targetPath) ? dirname(targetPath) : targetPath;
  const relativePath = normalizeSlashPath(relative(repoRoot, issueRoot));
  if (!relativePath || relativePath === "." || relativePath.startsWith("..") || isAbsolute(relativePath)) return "";
  return relativePath.replace(/\/+$/, "");
}

export function repoRootForTarget(target, options = {}) {
  const preferredRoot = options.preferredRoot ? resolve(options.preferredRoot) : "";
  const rawTarget = typeof target === "string" ? target : "";
  const targetPath = isAbsolute(rawTarget) ? rawTarget : resolve(process.cwd(), rawTarget || ".");
  if (preferredRoot && pathStartsWithin(preferredRoot, targetPath)) return preferredRoot;

  const start = safeIsFile(targetPath) ? dirname(targetPath) : targetPath;
  for (let current = start; ; current = dirname(current)) {
    if (existsSync(resolve(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return preferredRoot || process.cwd();
  }
}

export function pathStartsWith(filePath, prefix) {
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

export function normalizeSlashPath(filePath) {
  return String(filePath).replaceAll("\\", "/");
}

function safeIsFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function pathStartsWithin(parent, child) {
  const relativePath = relative(canonicalPath(parent), canonicalPath(child));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function canonicalPath(filePath) {
  try {
    return realpathSync(filePath);
  } catch {
    return resolve(filePath);
  }
}
