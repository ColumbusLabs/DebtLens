import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";
import { Project, ScriptTarget, ts } from "ts-morph";
import { allDetectors } from "../detectors/index.js";
import { buildDuplicateLogicClusters, buildRuleCorrelations, summarizeIssues } from "./issueAggregates.js";
import { buildImportGraphFromFiles } from "./importGraph.js";
import { DEFAULT_SOURCE_LANGUAGE, detectSourceLanguage, languagesForDetector, parseSourceFile } from "./languages.js";
import { isCrossFileDetector, resolveConcurrency, runBuiltinDetectorsInWorkers, shouldUseWorkerPool } from "./parallelScan.js";
import { canonicalize, resolveFileSelection, type FileSelection } from "./resolveFiles.js";
import { buildScanCacheKey, getScanCachePath, hashContent, readCachedScan, writeCachedScan, type FileSnapshot } from "./scanCache.js";
import { compareSeverityDesc, meetsMinSeverity } from "./severity.js";
import { applyInlineSuppressions } from "./suppressions.js";
import { suggestClosest } from "../utils/didYouMean.js";
import { computeIssueFingerprint } from "../utils/fingerprint.js";
import type { DebtIssue, Detector, DetectorContext, ReportedDebtIssue, ScanOptions, ScanResult, SourceFileInfo, SourceLanguage } from "./types.js";

interface CoreScanInputs {
  fileSelection: FileSelection;
  registry: Detector[];
  detectors: Detector[];
  snapshots: FileSnapshot[];
  cacheDisabledReason?: string;
  cachePath?: string;
  cacheKey?: string;
}

interface NormalizedIssueState {
  issues: DebtIssue[];
  filteredByMinSeverity: number;
  filteredByConfidenceFloor: number;
  ruleTimingsMs: Record<string, number>;
}

export async function scan(options: ScanOptions): Promise<ScanResult> {
  const startedAt = Date.now();
  const inputs = await prepareCoreScanInputs(options);
  const cached = tryReadScanCache(inputs, options, startedAt);
  if (cached) return cached;

  const project = createScanProject();
  const files = await loadSourceFiles(project, inputs.snapshots, options);
  const warnings = collectInitialWarnings(inputs, options);
  const detectorResults = await runDetectors(inputs.detectors, inputs.snapshots, {
    project,
    files,
    options,
    getThreshold: (key, fallback) => getThreshold(options, key, fallback),
  });
  appendDetectorWarnings(warnings, detectorResults);

  const normalizedIssues = normalizeAndFilterDetectorIssues(detectorResults, options);
  const result = buildScanResult({
    files,
    inputs,
    normalizedIssues,
    options,
    startedAt,
    warnings,
  });

  if (inputs.cachePath && inputs.cacheKey) {
    writeCachedScan(inputs.cachePath, inputs.cacheKey, inputs.snapshots, result);
  }

  return result;
}

async function prepareCoreScanInputs(options: ScanOptions): Promise<CoreScanInputs> {
  const fileSelection = await resolveFileSelection(options);
  const filePaths = fileSelection.paths;
  const registry = [...allDetectors, ...(options.pluginDetectors ?? [])];
  const detectors = selectDetectors(registry, options.rules, filePaths.map(detectSourceLanguage));
  const snapshots = loadFileSnapshots(filePaths, options);
  const cacheDisabledReason = options.cache && options.pluginDetectors?.length
    ? "scan cache disabled when plugin detectors are loaded because plugin implementations cannot be content-hash invalidated"
    : undefined;
  const cachePath = options.cache && !cacheDisabledReason ? getScanCachePath(options) : undefined;
  const cacheKey = cachePath ? buildScanCacheKey(options, detectors, snapshots) : undefined;

  return {
    fileSelection,
    registry,
    detectors,
    snapshots,
    cacheDisabledReason,
    cachePath,
    cacheKey,
  };
}

function tryReadScanCache(
  inputs: CoreScanInputs,
  options: ScanOptions,
  startedAt: number,
): ScanResult | undefined {
  if (!inputs.cachePath || !inputs.cacheKey) return undefined;

  const cached = readCachedScan(inputs.cachePath, inputs.cacheKey, inputs.snapshots, options.target);
  if (!cached) return undefined;

  cached.summary.elapsedMs = Date.now() - startedAt;
  cached.summary.performance = {
    ...(cached.summary.performance ?? {}),
    cache: { enabled: true, hit: true, path: inputs.cachePath },
    ...(options.batchSize ? { batchSize: options.batchSize } : {}),
    ...(options.parallel || (options.concurrency ?? 0) > 1 ? { parallel: true } : {}),
    ...(options.concurrency ? { concurrency: options.concurrency } : {}),
  };
  return cached;
}

function createScanProject(): Project {
  return new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.ReactJSX,
      target: ScriptTarget.ES2022,
      skipLibCheck: true,
    },
    skipAddingFilesFromTsConfig: true,
  });
}

function collectInitialWarnings(inputs: CoreScanInputs, options: ScanOptions): string[] {
  const warnings: string[] = [];
  if (inputs.cacheDisabledReason) {
    warnings.push(inputs.cacheDisabledReason);
  }
  if (inputs.fileSelection.maxFilesApplied) {
    warnings.push(buildMaxFilesWarning(inputs.fileSelection.paths.length, inputs.fileSelection.totalMatchedFiles));
  }
  for (const warning of validatePerRuleOverrides(inputs.registry, options)) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }
  return warnings;
}

function appendDetectorWarnings(warnings: string[], detectorResults: DetectorRunResult[]): void {
  for (const { warnings: detectorWarnings } of detectorResults) {
    for (const warning of detectorWarnings) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
  }
}

function normalizeAndFilterDetectorIssues(
  detectorResults: DetectorRunResult[],
  options: ScanOptions,
): NormalizedIssueState {
  const issues: DebtIssue[] = [];
  let filteredByMinSeverity = 0;
  let filteredByConfidenceFloor = 0;
  const ruleTimingsMs: Record<string, number> = {};

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

  return {
    issues,
    filteredByMinSeverity,
    filteredByConfidenceFloor,
    ruleTimingsMs,
  };
}

function buildScanResult(input: {
  files: SourceFileInfo[];
  inputs: CoreScanInputs;
  normalizedIssues: NormalizedIssueState;
  options: ScanOptions;
  startedAt: number;
  warnings: string[];
}): ScanResult {
  const issues = sortIssues(input.normalizedIssues.issues);
  const validRuleIds = new Set(input.inputs.registry.map((detector) => detector.id));
  const evaluatedRuleIds = new Set(input.inputs.detectors.map((detector) => detector.id));
  const suppression = applyInlineSuppressions(issues, input.files, validRuleIds, evaluatedRuleIds);
  for (const warning of suppression.warnings) {
    if (!input.warnings.includes(warning)) input.warnings.push(warning);
  }

  const filterStats = {
    ...(input.normalizedIssues.filteredByMinSeverity > 0
      ? { filteredByMinSeverity: input.normalizedIssues.filteredByMinSeverity }
      : {}),
    ...(input.normalizedIssues.filteredByConfidenceFloor > 0
      ? { filteredByConfidenceFloor: input.normalizedIssues.filteredByConfidenceFloor }
      : {}),
    ...(suppression.suppressedByInline > 0 ? { suppressedByInline: suppression.suppressedByInline } : {}),
  };
  const reportedIssues = toReportedIssues(suppression.issues);
  const issueSummary = summarizeIssues(reportedIssues);
  const correlations = buildRuleCorrelations(reportedIssues);
  const duplicateClusters = buildDuplicateLogicClusters(reportedIssues);
  const importGraph = buildImportGraphFromFiles(input.files.filter((file) => file.language === "tsjs"), true);

  return {
    schemaVersion: 1,
    issues: reportedIssues,
    ...(suppression.suppressions.length > 0 ? { suppressions: suppression.suppressions } : {}),
    ...(input.options.auditSuppressions && suppression.suppressionDirectives.length > 0
      ? { suppressionDirectives: suppression.suppressionDirectives }
      : {}),
    summary: {
      totalIssues: issueSummary.totalIssues,
      bySeverity: issueSummary.bySeverity,
      byRule: issueSummary.byRule,
      filesScanned: input.files.length,
      rulesRun: input.inputs.detectors.length,
      elapsedMs: Date.now() - input.startedAt,
      ...(input.warnings.length ? { warnings: input.warnings } : {}),
      ...(Object.keys(filterStats).length > 0 ? { filterStats } : {}),
      ...(correlations.length > 0 ? { correlations } : {}),
      ...(duplicateClusters.length > 0 ? { duplicateClusters } : {}),
      importGraph,
      ...(input.options.profile ? { profile: { ruleTimingsMs: input.normalizedIssues.ruleTimingsMs } } : {}),
      ...buildPerformanceSummary(input.inputs, input.options),
    },
    options: {
      target: input.options.target,
      include: input.options.include,
      exclude: input.options.exclude,
      minSeverity: input.options.minSeverity,
      rules: input.options.rules,
    },
  };
}

function sortIssues(issues: DebtIssue[]): DebtIssue[] {
  return issues.sort((a, b) => {
    const severity = compareSeverityDesc(a.severity, b.severity);
    if (severity !== 0) return severity;
    const byFile = a.file.localeCompare(b.file);
    if (byFile !== 0) return byFile;
    return (a.location?.startLine ?? 0) - (b.location?.startLine ?? 0);
  });
}

function buildPerformanceSummary(inputs: CoreScanInputs, options: ScanOptions): Pick<ScanResult["summary"], "performance"> {
  if (!inputs.cachePath && !options.batchSize && !options.parallel && (options.concurrency ?? 0) <= 1) {
    return {};
  }

  return {
    performance: {
      ...(inputs.cachePath ? { cache: { enabled: true, hit: false, path: inputs.cachePath } } : {}),
      ...(options.batchSize ? { batchSize: options.batchSize } : {}),
      ...(options.parallel || (options.concurrency ?? 0) > 1 ? { parallel: true } : {}),
      ...(options.concurrency ? { concurrency: options.concurrency } : {}),
    },
  };
}

function buildMaxFilesWarning(scannedFiles: number, totalMatchedFiles: number): string {
  return `DebtLens scanned the first ${scannedFiles} of ${totalMatchedFiles} matched files because maxFiles is capped. Use --max-files, --package, --include, --exclude, --rules, --changed, or --respect-gitignore to tune scope.`;
}

function loadFileSnapshots(filePaths: string[], options: ScanOptions): FileSnapshot[] {
  return filePaths.map((absolutePath) => {
    const content = getContentOverride(options, absolutePath) ?? readFileSync(absolutePath, "utf8");
    return {
      absolutePath,
      cacheIdentity: absolutePath === options.target
        ? basename(absolutePath)
        : relative(options.target, absolutePath).replaceAll("\\", "/"),
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
      const relativePath = snapshot.absolutePath === options.target
        ? basename(snapshot.absolutePath)
        : relative(options.target, snapshot.absolutePath).replaceAll("\\", "/");
      const language = detectSourceLanguage(snapshot.absolutePath);
      files.push(parseSourceFile({
        project,
        absolutePath: snapshot.absolutePath,
        relativePath,
        content: snapshot.content,
        language,
      }));
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
  snapshots: FileSnapshot[],
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

  if (shouldUseWorkerPool(contextBase.options)) {
    const builtinIds = new Set(allDetectors.map((detector) => detector.id));
    const builtinDetectors = detectors.filter((detector) => builtinIds.has(detector.id));
    const pluginDetectors = detectors.filter((detector) => !builtinIds.has(detector.id));
    const crossFileDetectors = builtinDetectors.filter(isCrossFileDetector);
    const fileLocalDetectors = builtinDetectors.filter((detector) => !isCrossFileDetector(detector));
    const concurrency = resolveConcurrency(contextBase.options);
    const [workerResults, crossFileResults, pluginResults] = await Promise.all([
      runBuiltinDetectorsInWorkers({
        detectors: fileLocalDetectors,
        snapshots,
        options: contextBase.options,
        concurrency,
      }),
      // Repository-wide rules are their own explicit aggregation phase. They
      // run once with all files after discovery, never once per file shard.
      runWithConcurrency(crossFileDetectors, concurrency, runOne),
      // Plugin functions cannot be structured-cloned. Retain the established
      // in-process execution path for them while built-ins use worker threads.
      runWithConcurrency(pluginDetectors, concurrency, runOne),
    ]);
    const detectorById = new Map(detectors.map((detector) => [detector.id, detector]));
    const merged = [
      ...workerResults.map((result) => ({
        detector: detectorById.get(result.detectorId) as Detector,
        issues: result.issues,
        elapsedMs: result.elapsedMs,
        warnings: result.warnings,
      })),
      ...crossFileResults,
      ...pluginResults,
    ];
    const byId = new Map(merged.map((result) => [result.detector.id, result]));
    return detectors.map((detector) => byId.get(detector.id) as DetectorRunResult);
  }

  const results: DetectorRunResult[] = [];
  for (const detector of detectors) {
    results.push(await runOne(detector));
  }
  return results;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  runOne: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await runOne(items[index] as T);
    }
  }));
  return results;
}

function filesForDetector(detector: Detector, files: SourceFileInfo[]): SourceFileInfo[] {
  const languages = languagesForDetector(detector);
  const allowed = new Set(languages);
  return files.filter((file) => allowed.has(file.language));
}

function normalizeIssueIdentity(issue: DebtIssue): void {
  const fingerprint = issue.fingerprint ?? computeIssueFingerprint(issue);
  issue.fingerprint = fingerprint;
  issue.id = fingerprint;
}

function toReportedIssues(issues: DebtIssue[]): ReportedDebtIssue[] {
  return issues.map((issue) => {
    normalizeIssueIdentity(issue);
    return issue as ReportedDebtIssue;
  });
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
  const languages = languagesForDetector(detector);
  const available = new Set(sourceLanguages.length > 0 ? sourceLanguages : [DEFAULT_SOURCE_LANGUAGE]);
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
