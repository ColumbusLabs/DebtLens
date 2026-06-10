import type { Project, SourceFile } from "ts-morph";

export type Severity = "info" | "low" | "medium" | "high";
export type OutputFormat = "terminal" | "json" | "markdown" | "pr-comment" | "sarif";

export interface IssueLocation {
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export interface DebtIssue {
  id: string;
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
  /** Built-in rule pack preset (core, react, react-native, next). */
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

export interface ScanProfile {
  ruleTimingsMs: Record<string, number>;
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
  profile?: ScanProfile;
}

export interface ScanResult {
  issues: DebtIssue[];
  summary: ScanSummary;
  options: Pick<ScanOptions, "target" | "include" | "exclude" | "minSeverity" | "rules">;
}
