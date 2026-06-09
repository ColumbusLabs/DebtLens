import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { Project, ScriptTarget, ts } from "ts-morph";
import { allDetectors } from "../detectors/index.js";
import { canonicalize, resolveFilePaths } from "./resolveFiles.js";
import { compareSeverityDesc, meetsMinSeverity } from "./severity.js";
import { applyInlineSuppressions } from "./suppressions.js";
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
  let issues: DebtIssue[] = [];
  const warnings: string[] = [];
  let filteredByMinSeverity = 0;
  const ruleTimingsMs: Record<string, number> = {};

  for (const detector of detectors) {
    const detectorStartedAt = options.profile ? Date.now() : 0;
    const detectorIssues = await detector.detect({
      project,
      files,
      options,
      getThreshold: (key, fallback) => getThreshold(options, key, fallback),
      addWarning: (warning) => {
        if (!warnings.includes(warning)) warnings.push(warning);
      },
    });
    for (const issue of detectorIssues) {
      if (meetsMinSeverity(issue.severity, options.minSeverity)) {
        issues.push(issue);
      } else {
        filteredByMinSeverity += 1;
      }
    }
    if (options.profile) {
      ruleTimingsMs[detector.id] = Date.now() - detectorStartedAt;
    }
  }

  issues.sort((a, b) => {
    const severity = compareSeverityDesc(a.severity, b.severity);
    if (severity !== 0) return severity;
    const byFile = a.file.localeCompare(b.file);
    if (byFile !== 0) return byFile;
    return (a.location?.startLine ?? 0) - (b.location?.startLine ?? 0);
  });

  const validRuleIds = new Set(allDetectors.map((detector) => detector.id));
  const suppression = applyInlineSuppressions(issues, files, validRuleIds);
  issues = suppression.issues;
  for (const warning of suppression.warnings) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  const filterStats = {
    ...(filteredByMinSeverity > 0 ? { filteredByMinSeverity } : {}),
    ...(suppression.suppressedByInline > 0 ? { suppressedByInline: suppression.suppressedByInline } : {}),
  };

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
    ...(Object.keys(filterStats).length > 0 ? { filterStats } : {}),
    ...(options.profile ? { profile: { ruleTimingsMs } } : {}),
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
