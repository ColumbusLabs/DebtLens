import type { Project, SourceFile } from "ts-morph";
import type { ImportGraph } from "./importGraph.js";

export type Severity = "info" | "low" | "medium" | "high";
export type OutputFormat = "terminal" | "json" | "markdown" | "pr-comment" | "sarif" | "html" | "junit" | "gitlab-codequality" | "badge";
export type TerminalGroupBy = "severity" | "rule" | "file";
export type GatePreset = "advisory" | "new-code" | "strict-new-code" | "legacy-baseline";

export interface IssueLocation {
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export interface DebtIssue {
  id: string;
  /** Line-stable finding fingerprint used for baselines and external integrations. */
  fingerprint?: string;
  ruleId: string;
  ruleName: string;
  severity: Severity;
  confidence: number;
  message: string;
  file: string;
  location?: IssueLocation;
  /** Optional git blame age in whole days for the finding start line. */
  introducedDaysAgo?: number;
  /** Composite payoff ranking score when churn/priority data is available. */
  payoffScore?: number;
  evidence?: string[];
  suggestion?: string;
  tags: string[];
}

export interface ReportedDebtIssue extends DebtIssue {
  fingerprint: string;
}

export interface SourceFileInfo {
  absolutePath: string;
  relativePath: string;
  content: string;
  language: SourceLanguage;
  sourceFile: SourceFile;
}

export type SourceLanguage = "tsjs" | "python" | "kotlin" | "swift" | "ruby" | "vue" | "svelte";

export interface ScanThresholds {
  [key: string]: number;
}

export interface FeatureFlagAccessPattern {
  /** Exact callee name, such as `isEnabled` or `featureClient.isEnabled`. */
  callee: string;
  /** Zero-based argument containing the literal flag key. Defaults to 0. */
  keyArgument?: number;
}

export interface FeatureFlagsConfig {
  /** Call shapes that read a flag by literal key. */
  accessPatterns?: FeatureFlagAccessPattern[];
  /** Registry file globs, relative to the scan target. */
  registryGlobs?: string[];
  /** Regexes identifying top-level boolean flag constants outside registries. */
  constantNamePatterns?: string[];
}

export interface DebtLensConfig {
  include?: string[];
  exclude?: string[];
  minSeverity?: Severity;
  /** Built-in rule pack preset (for example core, react, next, expo, or maintainer packs). */
  pack?: string;
  rules?: string[];
  thresholds?: ScanThresholds;
  maxFiles?: number;
  /** When true, skip files ignored by git in addition to configured excludes. */
  respectGitignore?: boolean;
  /** Concept id -> competing term variants, used by the naming-drift rule. */
  vocabulary?: Record<string, string[]>;
  /** Prop-drilling rule configuration. */
  propDrilling?: {
    ignoreComponents?: string[];
  };
  /** Duplicated-literal rule configuration. */
  duplicatedLiteral?: {
    /** Exact string literal values to ignore. */
    ignoreStrings?: string[];
  };
  /** Naming-drift rule configuration. */
  namingDrift?: {
    /** When true, skip built-in concept groups; only user `vocabulary` applies. */
    disableBuiltInVocabulary?: boolean;
  };
  /** Todo-comment rule configuration. */
  todoComment?: {
    /** Extra marker patterns (regex strings). */
    markers?: Array<{ pattern: string; severity?: Severity; label?: string }>;
    /** When true, built-in patterns are not used. */
    replaceDefaults?: boolean;
    /** Built-in labels to disable (e.g. "todo marker"). */
    disableDefaults?: string[];
  };
  /** Stale feature-flag detector configuration. */
  featureFlags?: FeatureFlagsConfig;
  /** Plugin API version this config targets; must match the DebtLens runtime version. */
  pluginApiVersion?: number;
  /** Paths to local ESM plugin modules, resolved relative to the config file directory. */
  plugins?: string[];
  /** Exit with code 1 when any reported issue meets this severity. CLI `--fail-on` overrides. */
  failOn?: Severity;
  /** Exit with code 1 only when a reported issue meets `--fail-on` and this confidence floor. */
  failOnConfidence?: number;
  /** Named quality-gate rollout preset. Explicit CLI/config gate flags can override its defaults. */
  gatePreset?: GatePreset;
  /** Per-path debt budgets for area-level SLO gating. */
  budgets?: Record<string, {
    maxIssues?: number;
    maxHigh?: number;
    maxMedium?: number;
  }>;
  /** Badge color thresholds for `--format badge`. */
  badge?: {
    greenMax?: number;
    yellowMax?: number;
  };
  /** Payoff ranking weights for `--sort payoff`. */
  priority?: {
    severity?: Partial<Record<Severity, number>>;
    churn?: number;
    age?: number;
  };
  /** Rule id -> severity reported for that rule's issues, replacing the detector's choice. */
  ruleSeverities?: Record<string, Severity>;
  /** Rule id -> minimum confidence; issues from that rule below the floor are not reported. */
  ruleConfidenceFloors?: Record<string, number>;
}

export interface ScanOptions {
  cwd: string;
  target: string;
  include: string[];
  exclude: string[];
  minSeverity: Severity;
  pack?: string;
  rules?: string[];
  thresholds: ScanThresholds;
  maxFiles?: number;
  /** When true, skip files ignored by git in addition to configured excludes. */
  respectGitignore?: boolean;
  vocabulary?: Record<string, string[]>;
  /** When true, naming-drift uses only user `vocabulary`, not built-in concept groups. */
  namingDriftDisableBuiltInVocabulary?: boolean;
  /** When set, only scan files whose absolute path is in this list (--changed mode). */
  changedFiles?: string[];
  /** Absolute file path -> source text override, used when scanning staged git blobs. */
  fileContents?: Record<string, string>;
  /** Prop-drilling rule configuration. */
  propDrillingIgnoreComponents?: string[];
  /** Exact string literal values ignored by the duplicated-literal rule. */
  duplicatedLiteralIgnoreStrings?: string[];
  /** Todo-comment rule configuration. */
  todoCommentReplaceDefaults?: boolean;
  todoCommentDisableDefaults?: string[];
  todoCommentMarkers?: Array<{ regex: RegExp; severity: Severity; label: string }>;
  /** Configurable feature-flag access, registry, and constant-name contract. */
  featureFlags?: FeatureFlagsConfig;
  /** When true, collect per-rule timing in `summary.profile`. */
  profile?: boolean;
  /** When true, emit valid inline suppression directives, including unused entries, for stale-suppression audits. */
  auditSuppressions?: boolean;
  /** When true, reuse unchanged scan results from a content-hash cache. */
  cache?: boolean;
  /** Optional path to the scan cache file. Defaults to `.debtlens/cache.json` in cwd. */
  cachePath?: string;
  /** Load source files in bounded batches, yielding between batches for large scans. */
  batchSize?: number;
  /** Run detectors concurrently after source loading. Results remain sorted deterministically. */
  parallel?: boolean;
  /** Worker-thread concurrency for large scans (`--concurrency`). */
  concurrency?: number;
  /** Shared cache directory override (`--cache-dir`). */
  cacheDir?: string;
  /** Detectors contributed by config-loaded plugins, merged after built-in rules. */
  pluginDetectors?: Detector[];
  /** Rule id -> severity reported for that rule's issues, replacing the detector's choice. */
  ruleSeverities?: Record<string, Severity>;
  /** Rule id -> minimum confidence; issues from that rule below the floor are not reported. */
  ruleConfidenceFloors?: Record<string, number>;
  /** Per-path debt budgets loaded from config. */
  budgets?: DebtLensConfig["budgets"];
}

export interface CliOptions {
  cwd?: string;
  include?: string[];
  exclude?: string[];
  minSeverity?: Severity;
  pack?: string;
  rules?: string[];
  thresholds?: ScanThresholds;
  maxFiles?: number;
  respectGitignore?: boolean;
  format?: OutputFormat;
  output?: string;
  failOn?: Severity;
  failOnConfidence?: number;
  gatePreset?: GatePreset;
  configPath?: string;
  noColor?: boolean;
  changedFiles?: string[];
  fileContents?: Record<string, string>;
  profile?: boolean;
  auditSuppressions?: boolean;
  cache?: boolean;
  cachePath?: string;
  batchSize?: number;
  parallel?: boolean;
  concurrency?: number;
  cacheDir?: string;
  pluginDetectors?: Detector[];
  /** Threshold defaults contributed by plugins; user config and CLI thresholds override. */
  pluginThresholds?: ScanThresholds;
  /** Naming-drift vocabulary contributed by plugins; user config groups override on id. */
  pluginVocabulary?: Record<string, string[]>;
  /** Per-path debt budgets loaded from config. */
  budgets?: DebtLensConfig["budgets"];
  /** Badge color thresholds. */
  badge?: DebtLensConfig["badge"];
}

export interface DetectorContext {
  project: Project;
  files: SourceFileInfo[];
  options: ScanOptions;
  getThreshold: (key: string, fallback: number) => number;
  addWarning: (warning: string) => void;
}

export interface Detector {
  id: string;
  name: string;
  description: string;
  defaultSeverity: Severity;
  tags: string[];
  /** Languages this detector understands. Omitted means TypeScript/JavaScript only. */
  languages?: SourceLanguage[];
  detect: (context: DetectorContext) => Promise<DebtIssue[]> | DebtIssue[];
}

export interface ScanFilterStats {
  filteredByMinSeverity?: number;
  filteredByConfidenceFloor?: number;
  suppressedByBaseline?: number;
  suppressedByInline?: number;
}

export interface ScanCountSummary {
  totalIssues: number;
  bySeverity: Record<Severity, number>;
  byRule: Record<string, number>;
}

export interface ScanBaselineDelta {
  /** Current findings not covered by the compared baseline. */
  new: number;
  /** Baseline findings no longer present in the current scan. */
  resolved: number;
  /** Findings with the same fingerprint but changed metadata such as severity. */
  changed: number;
  /** Known findings whose severity increased versus the baseline snapshot. */
  severityRegressions: number;
  /** Current total minus baseline total. Positive means the debt count regressed. */
  totalDelta: number;
  baseline: ScanCountSummary;
  current: ScanCountSummary;
  /** False for legacy baselines that lack per-rule/per-severity count metadata. */
  hasBaselineSummary: boolean;
  byRule: Record<string, { baseline: number; current: number; delta: number }>;
}

export interface RuleCorrelation {
  file: string;
  totalIssues: number;
  rules: Array<{
    ruleId: string;
    ruleName: string;
    count: number;
  }>;
}

export interface DuplicateLogicCluster {
  clusterId: string;
  issueCount: number;
  locations: Array<{
    file: string;
    startLine: number;
    endLine?: number;
  }>;
}

export interface DebtHeatmapEntry {
  file: string;
  totalIssues: number;
  distinctRules: number;
  bySeverity: Record<Severity, number>;
}

export interface FixTarget {
  file: string;
  totalIssues: number;
  distinctRules: number;
  duplicateClusters: number;
  bySeverity: Record<Severity, number>;
  score: number;
  reasons: string[];
  topRules: Array<{
    ruleId: string;
    count: number;
  }>;
}

export interface FileChurnMetric {
  file: string;
  repositoryPath: string;
  commits: number;
  additions: number;
  deletions: number;
  changedLines: number;
}

export interface DebtHotspot {
  file: string;
  repositoryPath: string;
  totalIssues: number;
  distinctRules: number;
  bySeverity: Record<Severity, number>;
  score: number;
  churn: FileChurnMetric;
  reasons: string[];
  topRules: Array<{
    ruleId: string;
    count: number;
  }>;
}

export interface ScanHotspotSummary {
  source: "git";
  window: {
    days?: number;
    since?: string;
    range?: string;
  };
  ranking: DebtHotspot[];
}

export interface CodeownersRule {
  pattern: string;
  owners: string[];
  line: number;
}

export interface CodeownersFile {
  path: string;
  root: string;
  rules: CodeownersRule[];
  warnings?: string[];
}

export interface OwnershipFileSummary {
  file: string;
  repositoryPath: string;
  owners: string[];
  totalIssues: number;
  bySeverity: Record<Severity, number>;
  matchedPattern?: string;
  matchedLine?: number;
}

export interface OwnershipHandoff {
  file: string;
  repositoryPath: string;
  owners: string[];
  totalIssues: number;
  distinctRules: number;
  bySeverity: Record<Severity, number>;
  score: number;
  reasons: string[];
  topRules: Array<{
    ruleId: string;
    count: number;
  }>;
  matchedPattern?: string;
  matchedLine?: number;
}

export interface OwnershipOwnerSummary {
  owner: string;
  files: number;
  totalIssues: number;
  bySeverity: Record<Severity, number>;
  topFiles: Array<{
    file: string;
    totalIssues: number;
    score: number;
  }>;
}

export interface ScanOwnershipSummary {
  source: "codeowners";
  codeownersPath: string;
  files: OwnershipFileSummary[];
  ownerSummaries: OwnershipOwnerSummary[];
  handoffs: OwnershipHandoff[];
  unownedHotspots: OwnershipHandoff[];
  warnings?: string[];
}

export interface InlineSuppressionAudit {
  ruleId: string;
  file: string;
  kind: "next-line" | "file";
  reason: string;
  directiveLine: number;
  targetLine?: number;
  issue: DebtIssue;
}

export interface SuppressionDirectiveAudit {
  ruleId: string;
  file: string;
  kind: "next-line" | "file";
  reason: string;
  directiveLine: number;
  targetLine?: number;
  status: "used" | "unused" | "not-evaluated";
  suppressedIssueCount: number;
  recommendedAction: string;
}

export interface ScanProfile {
  ruleTimingsMs: Record<string, number>;
}

export interface ScanPerformance {
  cache?: {
    enabled: boolean;
    hit: boolean;
    path: string;
  };
  batchSize?: number;
  parallel?: boolean;
  concurrency?: number;
}

export interface CacheKeyInput {
  version: number;
  packageVersion: string;
  target: string;
  include: string[];
  exclude: string[];
  minSeverity: Severity;
  pack?: string;
  rules?: string[];
  thresholds: ScanThresholds;
  maxFiles?: number;
  respectGitignore?: boolean;
  profile?: boolean;
  auditSuppressions?: boolean;
  changedFiles?: string[];
  detectorIds: string[];
  ruleSeverities?: Record<string, Severity>;
  ruleConfidenceFloors?: Record<string, number>;
  vocabulary?: Record<string, string[]>;
  namingDriftDisableBuiltInVocabulary?: boolean;
  propDrillingIgnoreComponents?: string[];
  duplicatedLiteralIgnoreStrings?: string[];
  todoCommentReplaceDefaults?: boolean;
  todoCommentDisableDefaults?: string[];
  todoCommentMarkers?: Array<{ regex: string; severity: Severity; label: string }>;
  featureFlags?: FeatureFlagsConfig;
}

export function toCacheKeyPayload(
  cacheVersion: number,
  packageVersion: string,
  options: ScanOptions,
  detectors: Detector[],
): CacheKeyInput {
  return {
    version: cacheVersion,
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
    auditSuppressions: options.auditSuppressions,
    changedFiles: options.changedFiles,
    detectorIds: detectors.map((detector) => detector.id),
    ruleSeverities: options.ruleSeverities,
    ruleConfidenceFloors: options.ruleConfidenceFloors,
    vocabulary: options.vocabulary,
    namingDriftDisableBuiltInVocabulary: options.namingDriftDisableBuiltInVocabulary,
    propDrillingIgnoreComponents: options.propDrillingIgnoreComponents,
    duplicatedLiteralIgnoreStrings: options.duplicatedLiteralIgnoreStrings,
    todoCommentReplaceDefaults: options.todoCommentReplaceDefaults,
    todoCommentDisableDefaults: options.todoCommentDisableDefaults,
    todoCommentMarkers: options.todoCommentMarkers?.map((marker) => ({
      regex: String(marker.regex),
      severity: marker.severity,
      label: marker.label,
    })),
    featureFlags: options.featureFlags,
  };
}

export interface ScanSummary {
  totalIssues: number;
  bySeverity: Record<Severity, number>;
  byRule: Record<string, number>;
  filesScanned: number;
  rulesRun: number;
  elapsedMs: number;
  warnings?: string[];
  filterStats?: ScanFilterStats;
  deltaFromBaseline?: ScanBaselineDelta;
  correlations?: RuleCorrelation[];
  duplicateClusters?: DuplicateLogicCluster[];
  hotspots?: ScanHotspotSummary;
  ownership?: ScanOwnershipSummary;
  profile?: ScanProfile;
  performance?: ScanPerformance;
  importGraph?: ImportGraph;
}

export interface ScanResult {
  schemaVersion: 1;
  issues: ReportedDebtIssue[];
  suppressions?: InlineSuppressionAudit[];
  suppressionDirectives?: SuppressionDirectiveAudit[];
  summary: ScanSummary;
  options: Pick<ScanOptions, "target" | "include" | "exclude" | "minSeverity" | "rules">;
}
