import { readFileSync, realpathSync, statSync } from "node:fs";
import { relative } from "node:path";
import fg from "fast-glob";
import { Project, ScriptTarget, ts } from "ts-morph";
import { allDetectors } from "../detectors/index.js";
import { getIgnoredFiles } from "../utils/git.js";
import { compareSeverityDesc, meetsMinSeverity } from "./severity.js";
import type { DebtIssue, Detector, ScanOptions, ScanResult, SourceFileInfo } from "./types.js";

export async function scan(options: ScanOptions): Promise<ScanResult> {
  const startedAt = Date.now();
  const filePaths = await resolveFilePaths(options);

  const project = new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.ReactJSX,
      target: ScriptTarget.ES2022,
      skipLibCheck: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  const files: SourceFileInfo[] = [];
  for (const absolutePath of filePaths) {
    const contentOverride = getContentOverride(options, absolutePath);
    const sourceFile = contentOverride === undefined
      ? project.addSourceFileAtPathIfExists(absolutePath)
      : project.createSourceFile(absolutePath, contentOverride, { overwrite: true });
    if (!sourceFile) continue;
    files.push({
      absolutePath,
      relativePath: relative(options.target, absolutePath).replaceAll("\\", "/"),
      content: contentOverride ?? readFileSync(absolutePath, "utf8"),
      sourceFile,
    });
  }

  const detectors = selectDetectors(options.rules);
  const issues: DebtIssue[] = [];
  const warnings: string[] = [];

  for (const detector of detectors) {
    const detectorIssues = await detector.detect({
      project,
      files,
      options,
      getThreshold: (key, fallback) => getThreshold(options, key, fallback),
      addWarning: (warning) => {
        if (!warnings.includes(warning)) warnings.push(warning);
      },
    });
    issues.push(...detectorIssues.filter((issue) => meetsMinSeverity(issue.severity, options.minSeverity)));
  }

  issues.sort((a, b) => {
    const severity = compareSeverityDesc(a.severity, b.severity);
    if (severity !== 0) return severity;
    const byFile = a.file.localeCompare(b.file);
    if (byFile !== 0) return byFile;
    return (a.location?.startLine ?? 0) - (b.location?.startLine ?? 0);
  });

  const summary = {
    totalIssues: issues.length,
    bySeverity: {
      info: issues.filter((issue) => issue.severity === "info").length,
      low: issues.filter((issue) => issue.severity === "low").length,
      medium: issues.filter((issue) => issue.severity === "medium").length,
      high: issues.filter((issue) => issue.severity === "high").length,
    },
    byRule: issues.reduce<Record<string, number>>((accumulator, issue) => {
      accumulator[issue.ruleId] = (accumulator[issue.ruleId] ?? 0) + 1;
      return accumulator;
    }, {}),
    filesScanned: files.length,
    rulesRun: detectors.length,
    elapsedMs: Date.now() - startedAt,
    ...(warnings.length ? { warnings } : {}),
  };

  return {
    issues,
    summary,
    options: {
      target: options.target,
      include: options.include,
      exclude: options.exclude,
      minSeverity: options.minSeverity,
      rules: options.rules,
    },
  };
}

async function resolveFilePaths(options: ScanOptions): Promise<string[]> {
  const stats = statSync(options.target);
  const isFile = stats.isFile();
  // Canonicalize so the --changed set (paths from git, which resolves symlinks like
  // macOS /var -> /private/var) matches fast-glob's output, which does not.
  const changed = options.changedFiles
    ? new Set(options.changedFiles.map(canonicalize))
    : undefined;

  if (isFile) {
    if (changed && !changed.has(canonicalize(options.target))) return [];
    if (options.respectGitignore && isIgnoredByGit(options.cwd, options.target)) return [];
    return [options.target];
  }

  let paths = await fg(options.include, {
    cwd: options.target,
    absolute: true,
    onlyFiles: true,
    ignore: options.exclude,
    dot: false,
    unique: true,
  });

  if (changed) {
    paths = paths.filter((path) => changed.has(canonicalize(path)));
  }

  if (options.respectGitignore) {
    const ignored = getIgnoredFiles(options.cwd, paths);
    if (ignored !== null) {
      paths = paths.filter((path) => !ignored.has(canonicalize(path)));
    }
  }

  return paths.slice(0, options.maxFiles ?? paths.length);
}

function isIgnoredByGit(cwd: string, path: string): boolean {
  const ignored = getIgnoredFiles(cwd, [path]);
  return ignored !== null && ignored.has(canonicalize(path));
}

function canonicalize(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function getContentOverride(options: ScanOptions, absolutePath: string): string | undefined {
  if (!options.fileContents) return undefined;
  return options.fileContents[canonicalize(absolutePath)] ?? options.fileContents[absolutePath];
}

function selectDetectors(ruleIds: string[] | undefined): Detector[] {
  if (!ruleIds || ruleIds.length === 0) {
    return allDetectors;
  }

  const requested = new Set(ruleIds);
  const selected = allDetectors.filter((detector) => requested.has(detector.id));
  const missing = [...requested].filter((ruleId) => !allDetectors.some((detector) => detector.id === ruleId));

  if (missing.length > 0) {
    throw new Error(`Unknown DebtLens rule(s): ${missing.join(", ")}`);
  }

  return selected;
}

function getThreshold(options: ScanOptions, key: string, fallback: number): number {
  const value = options.thresholds[key];
  return Number.isFinite(value) ? value : fallback;
}
