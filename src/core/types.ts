import type { Project, SourceFile } from "ts-morph";

export type Severity = "info" | "low" | "medium" | "high";
export type OutputFormat = "terminal" | "json" | "markdown" | "pr-comment" | "sarif" | "html" | "junit";
export type TerminalGroupBy = "severity" | "rule" | "file";

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
  evidence?: string[];
  suggestion?: string;
  tags: string[];
}

export interface SourceFileInfo {
  absolutePath: string;
  relativePath: string;
  content: string;
  sourceFile: SourceFile;
}

export interface ScanThresholds {
  [key: string]: number;
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
  /** Plugin API version this config targets; must match the DebtLens runtime version. */
  pluginApiVersion?: number;
  /** Paths to local ESM plugin modules, resolved relative to the config file directory. */
  plugins?: string[];
  /** Exit with code 1 when any reported issue meets this severity. CLI `--fail-on` overrides. */
  failOn?: Severity;
  /** Exit with code 1 only when a reported issue meets `--fail-on` and this confidence floor. */
  failOnConfidence?: number;
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
  /** Todo-comment rule configuration. */
  todoCommentReplaceDefaults?: boolean;
  todoCommentDisableDefaults?: string[];
  todoCommentMarkers?: Array<{ regex: RegExp; severity: Severity; label: string }>;
  /** When true, collect per-rule timing in `summary.profile`. */
  profile?: boolean;
  /** When true, reuse unchanged scan results from a content-hash cache. */
  cache?: boolean;
  /** Optional path to the scan cache file. Defaults to `.debtlens/cache.json` in cwd. */
  cachePath?: string;
  /** Load source files in bounded batches, yielding between batches for large scans. */
  batchSize?: number;
  /** Run detectors concurrently after source loading. Results remain sorted deterministically. */
  parallel?: boolean;
  /** Detectors contributed by config-loaded plugins, merged after built-in rules. */
  pluginDetectors?: Detector[];
  /** Rule id -> severity reported for that rule's issues, replacing the detector's choice. */
  ruleSeverities?: Record<string, Severity>;
  /** Rule id -> minimum confidence; issues from that rule below the floor are not reported. */
  ruleConfidenceFloors?: Record<string, number>;
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
  configPath?: string;
  noColor?: boolean;
  changedFiles?: string[];
  fileContents?: Record<string, string>;
  profile?: boolean;
  cache?: boolean;
  cachePath?: string;
  batchSize?: number;
  parallel?: boolean;
  pluginDetectors?: Detector[];
  /** Threshold defaults contributed by plugins; user config and CLI thresholds override. */
  pluginThresholds?: ScanThresholds;
  /** Naming-drift vocabulary contributed by plugins; user config groups override on id. */
  pluginVocabulary?: Record<string, string[]>;
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

export interface InlineSuppressionAudit {
  ruleId: string;
  file: string;
  kind: "next-line" | "file";
  reason: string;
  directiveLine: number;
  targetLine?: number;
  issue: DebtIssue;
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
  profile?: ScanProfile;
  performance?: ScanPerformance;
}

export interface ScanResult {
  schemaVersion: 1;
  issues: DebtIssue[];
  suppressions?: InlineSuppressionAudit[];
  summary: ScanSummary;
  options: Pick<ScanOptions, "target" | "include" | "exclude" | "minSeverity" | "rules">;
}
