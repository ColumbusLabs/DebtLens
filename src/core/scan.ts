import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { Project, ScriptTarget, ts } from "ts-morph";
import { allDetectors } from "../detectors/index.js";
import { buildDuplicateLogicClusters, buildRuleCorrelations, summarizeIssues } from "./issueAggregates.js";
import { canonicalize, resolveFilePaths } from "./resolveFiles.js";
import { compareSeverityDesc, meetsMinSeverity } from "./severity.js";
import { applyInlineSuppressions } from "./suppressions.js";
import { suggestClosest } from "../utils/didYouMean.js";
import { computeIssueFingerprint } from "../utils/fingerprint.js";
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

  const registry = [...allDetectors, ...(options.pluginDetectors ?? [])];
  const detectors = selectDetectors(registry, options.rules);
  let issues: DebtIssue[] = [];
  const warnings: string[] = [];
  let filteredByMinSeverity = 0;
  let filteredByConfidenceFloor = 0;
  const ruleTimingsMs: Record<string, number> = {};

  for (const warning of validatePerRuleOverrides(registry, options)) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

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

  const validRuleIds = new Set(registry.map((detector) => detector.id));
  const suppression = applyInlineSuppressions(issues, files, validRuleIds);
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
  const summary = {
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
  };

  return {
    schemaVersion: 1,
    issues,
    ...(suppression.suppressions.length > 0 ? { suppressions: suppression.suppressions } : {}),
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

function normalizeIssueIdentity(issue: DebtIssue): void {
  const fingerprint = issue.fingerprint ?? computeIssueFingerprint(issue);
  issue.fingerprint = fingerprint;
  issue.id = fingerprint;
}

function getContentOverride(options: ScanOptions, absolutePath: string): string | undefined {
  if (!options.fileContents) return undefined;
  return options.fileContents[canonicalize(absolutePath)] ?? options.fileContents[absolutePath];
}

function selectDetectors(registry: Detector[], ruleIds: string[] | undefined): Detector[] {
  if (!ruleIds || ruleIds.length === 0) {
    return registry;
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
