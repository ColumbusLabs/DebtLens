import { readFileSync } from "node:fs";
import { basename, extname, relative } from "node:path";
import { Project, ScriptTarget, ts } from "ts-morph";
import { allDetectors } from "../detectors/index.js";
import { buildDuplicateLogicClusters, buildRuleCorrelations, summarizeIssues } from "./issueAggregates.js";
import { canonicalize, resolveFilePaths } from "./resolveFiles.js";
import { buildScanCacheKey, getScanCachePath, hashContent, readCachedScan, writeCachedScan, type FileSnapshot } from "./scanCache.js";
import { compareSeverityDesc, meetsMinSeverity } from "./severity.js";
import { applyInlineSuppressions } from "./suppressions.js";
import { suggestClosest } from "../utils/didYouMean.js";
import { computeIssueFingerprint } from "../utils/fingerprint.js";
import type { DebtIssue, Detector, DetectorContext, ScanOptions, ScanResult, SourceFileInfo, SourceLanguage } from "./types.js";

export async function scan(options: ScanOptions): Promise<ScanResult> {
  const startedAt = Date.now();
  const filePaths = await resolveFilePaths(options);
  const registry = [...allDetectors, ...(options.pluginDetectors ?? [])];
  const detectors = selectDetectors(registry, options.rules, filePaths.map(detectSourceLanguage));
  const snapshots = loadFileSnapshots(filePaths, options);
  const cacheDisabledReason = options.cache && options.pluginDetectors?.length
    ? "scan cache disabled when plugin detectors are loaded because plugin implementations cannot be content-hash invalidated"
    : undefined;
  const cachePath = options.cache && !cacheDisabledReason ? getScanCachePath(options) : undefined;
  const cacheKey = cachePath ? buildScanCacheKey(options, detectors) : undefined;

  if (cachePath && cacheKey) {
    const cached = readCachedScan(cachePath, cacheKey, snapshots);
    if (cached) {
      cached.summary.elapsedMs = Date.now() - startedAt;
      cached.summary.performance = {
        ...(cached.summary.performance ?? {}),
        cache: { enabled: true, hit: true, path: cachePath },
        ...(options.batchSize ? { batchSize: options.batchSize } : {}),
        ...(options.parallel ? { parallel: true } : {}),
      };
      return cached;
    }
  }

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

  const files = await loadSourceFiles(project, snapshots, options);
  let issues: DebtIssue[] = [];
  const warnings: string[] = [];
  let filteredByMinSeverity = 0;
  let filteredByConfidenceFloor = 0;
  const ruleTimingsMs: Record<string, number> = {};

  if (cacheDisabledReason) {
    warnings.push(cacheDisabledReason);
  }
  for (const warning of validatePerRuleOverrides(registry, options)) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  const detectorResults = await runDetectors(detectors, {
    project,
    files,
    options,
    getThreshold: (key, fallback) => getThreshold(options, key, fallback),
  });

  for (const { warnings: detectorWarnings } of detectorResults) {
    for (const warning of detectorWarnings) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
  }

  for (const { detector, issues: detectorIssues, elapsedMs } of detectorResults) {
    for (const issue of detectorIssues) {
      normalizeIssueIdentity(issue);
      const severityOverride = options.ruleSeverities?.[issue.ruleId];
      if (severityOverride) {
        issue.severity = severityOverride;
      }
      const confidenceFloor = options.ruleConfidenceFloors?.[issue.ruleId];
      if (confidenceFloor !== undefined && issue.confidence < confidenceFloor) {
        filteredByConfidenceFloor += 1;
        continue;
      }
      if (meetsMinSeverity(issue.severity, options.minSeverity)) {
        issues.push(issue);
      } else {
        filteredByMinSeverity += 1;
      }
    }
    if (options.profile) {
      ruleTimingsMs[detector.id] = elapsedMs;
    }
  }

  issues.sort((a, b) => {
    const severity = compareSeverityDesc(a.severity, b.severity);
    if (severity !== 0) return severity;
    const byFile = a.file.localeCompare(b.file);
    if (byFile !== 0) return byFile;
    return (a.location?.startLine ?? 0) - (b.location?.startLine ?? 0);
  });

  const validRuleIds = new Set(registry.map((detector) => detector.id));
  const evaluatedRuleIds = new Set(detectors.map((detector) => detector.id));
  const suppression = applyInlineSuppressions(issues, files, validRuleIds, evaluatedRuleIds);
  issues = suppression.issues;
  for (const warning of suppression.warnings) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  const filterStats = {
    ...(filteredByMinSeverity > 0 ? { filteredByMinSeverity } : {}),
    ...(filteredByConfidenceFloor > 0 ? { filteredByConfidenceFloor } : {}),
    ...(suppression.suppressedByInline > 0 ? { suppressedByInline: suppression.suppressedByInline } : {}),
  };

  const issueSummary = summarizeIssues(issues);
  const correlations = buildRuleCorrelations(issues);
  const duplicateClusters = buildDuplicateLogicClusters(issues);
  const result: ScanResult = {
    schemaVersion: 1,
    issues,
    ...(suppression.suppressions.length > 0 ? { suppressions: suppression.suppressions } : {}),
    ...(options.auditSuppressions && suppression.suppressionDirectives.length > 0
      ? { suppressionDirectives: suppression.suppressionDirectives }
      : {}),
    summary: {
      totalIssues: issueSummary.totalIssues,
      bySeverity: issueSummary.bySeverity,
      byRule: issueSummary.byRule,
      filesScanned: files.length,
      rulesRun: detectors.length,
      elapsedMs: Date.now() - startedAt,
      ...(warnings.length ? { warnings } : {}),
      ...(Object.keys(filterStats).length > 0 ? { filterStats } : {}),
      ...(correlations.length > 0 ? { correlations } : {}),
      ...(duplicateClusters.length > 0 ? { duplicateClusters } : {}),
      ...(options.profile ? { profile: { ruleTimingsMs } } : {}),
      ...(cachePath || options.batchSize || options.parallel ? {
        performance: {
          ...(cachePath ? { cache: { enabled: true, hit: false, path: cachePath } } : {}),
          ...(options.batchSize ? { batchSize: options.batchSize } : {}),
          ...(options.parallel ? { parallel: true } : {}),
        },
      } : {}),
    },
    options: {
      target: options.target,
      include: options.include,
      exclude: options.exclude,
      minSeverity: options.minSeverity,
      rules: options.rules,
    },
  };

  if (cachePath && cacheKey) {
    writeCachedScan(cachePath, cacheKey, snapshots, result);
  }

  return result;
}

function loadFileSnapshots(filePaths: string[], options: ScanOptions): FileSnapshot[] {
  return filePaths.map((absolutePath) => {
    const content = getContentOverride(options, absolutePath) ?? readFileSync(absolutePath, "utf8");
    return {
      absolutePath,
      content,
      hash: hashContent(content),
    };
  });
}

async function loadSourceFiles(project: Project, snapshots: FileSnapshot[], options: ScanOptions): Promise<SourceFileInfo[]> {
  const files: SourceFileInfo[] = [];
  const batchSize = Math.max(1, options.batchSize ?? (snapshots.length || 1));

  for (let index = 0; index < snapshots.length; index += batchSize) {
    const batch = snapshots.slice(index, index + batchSize);
    for (const snapshot of batch) {
      const sourceFile = project.createSourceFile(snapshot.absolutePath, snapshot.content, { overwrite: true });
      const relativePath = snapshot.absolutePath === options.target
        ? basename(snapshot.absolutePath)
        : relative(options.target, snapshot.absolutePath).replaceAll("\\", "/");
      files.push({
        absolutePath: snapshot.absolutePath,
        relativePath,
        content: snapshot.content,
        language: detectSourceLanguage(snapshot.absolutePath),
        sourceFile,
      });
    }
    if (index + batchSize < snapshots.length) {
      await new Promise<void>((resolveYield) => setImmediate(resolveYield));
    }
  }

  return files;
}

interface DetectorRunResult {
  detector: Detector;
  issues: DebtIssue[];
  elapsedMs: number;
  warnings: string[];
}

async function runDetectors(
  detectors: Detector[],
  contextBase: Omit<DetectorContext, "addWarning">,
): Promise<DetectorRunResult[]> {
  const runOne = async (detector: Detector): Promise<DetectorRunResult> => {
    const detectorStartedAt = contextBase.options.profile ? Date.now() : 0;
    const warnings: string[] = [];
    const context: DetectorContext = {
      ...contextBase,
      files: filesForDetector(detector, contextBase.files),
      addWarning: (warning) => {
        if (!warnings.includes(warning)) warnings.push(warning);
      },
    };
    const issues = await detector.detect(context);
    return {
      detector,
      issues,
      elapsedMs: contextBase.options.profile ? Date.now() - detectorStartedAt : 0,
      warnings,
    };
  };

  if (contextBase.options.parallel) {
    return Promise.all(detectors.map((detector) => runOne(detector)));
  }

  const results: DetectorRunResult[] = [];
  for (const detector of detectors) {
    results.push(await runOne(detector));
  }
  return results;
}

function filesForDetector(detector: Detector, files: SourceFileInfo[]): SourceFileInfo[] {
  const languages = detector.languages ?? ["tsjs"];
  const allowed = new Set(languages);
  return files.filter((file) => allowed.has(file.language));
}

function detectSourceLanguage(path: string): SourceLanguage {
  return extname(path).toLowerCase() === ".py" ? "python" : "tsjs";
}

function normalizeIssueIdentity(issue: DebtIssue): void {
  const fingerprint = issue.fingerprint ?? computeIssueFingerprint(issue);
  issue.fingerprint = fingerprint;
  issue.id = fingerprint;
}

function getContentOverride(options: ScanOptions, absolutePath: string): string | undefined {
  if (!options.fileContents) return undefined;
  return options.fileContents[canonicalize(absolutePath)] ?? options.fileContents[absolutePath];
}

function selectDetectors(
  registry: Detector[],
  ruleIds: string[] | undefined,
  sourceLanguages: SourceLanguage[],
): Detector[] {
  if (!ruleIds || ruleIds.length === 0) {
    return registry.filter((detector) => detectorCanRunOnSourceLanguages(detector, sourceLanguages));
  }

  const requested = new Set(ruleIds);
  const selected = registry.filter((detector) => requested.has(detector.id));
  const missing = [...requested].filter((ruleId) => !registry.some((detector) => detector.id === ruleId));

  if (missing.length > 0) {
    const knownIds = registry.map((detector) => detector.id);
    const described = missing.map((ruleId) => {
      const suggestion = suggestClosest(ruleId, knownIds);
      return suggestion ? `${ruleId} (did you mean "${suggestion}"?)` : ruleId;
    });
    throw new Error(`Unknown DebtLens rule(s): ${described.join(", ")}`);
  }

  return selected;
}

function detectorCanRunOnSourceLanguages(detector: Detector, sourceLanguages: SourceLanguage[]): boolean {
  const languages = detector.languages ?? ["tsjs"];
  const available = new Set(sourceLanguages.length > 0 ? sourceLanguages : ["tsjs"]);
  return languages.some((language) => available.has(language));
}

function getThreshold(options: ScanOptions, key: string, fallback: number): number {
  const value = options.thresholds[key];
  return Number.isFinite(value) ? value : fallback;
}

/** Warn (not fail) on per-rule override keys that match no known rule, so typos surface. */
function validatePerRuleOverrides(registry: Detector[], options: ScanOptions): string[] {
  const knownIds = registry.map((detector) => detector.id);
  const knownIdSet = new Set(knownIds);
  const warnings: string[] = [];

  const describeUnknown = (configKey: string, ruleId: string) => {
    const suggestion = suggestClosest(ruleId, knownIds);
    const hint = suggestion ? ` (did you mean "${suggestion}"?)` : "";
    return `${configKey}: unknown rule "${ruleId}"${hint}`;
  };

  for (const ruleId of Object.keys(options.ruleSeverities ?? {})) {
    if (!knownIdSet.has(ruleId)) warnings.push(describeUnknown("ruleSeverities", ruleId));
  }
  for (const ruleId of Object.keys(options.ruleConfidenceFloors ?? {})) {
    if (!knownIdSet.has(ruleId)) warnings.push(describeUnknown("ruleConfidenceFloors", ruleId));
  }

  return warnings;
}
