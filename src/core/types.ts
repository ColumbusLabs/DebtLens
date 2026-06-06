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
  /** Todo-comment rule configuration. */
  todoComment?: {
    /** Extra marker patterns (regex strings). */
    markers?: Array<{ pattern: string; severity?: Severity; label?: string }>;
    /** When true, built-in patterns are not used. */
    replaceDefaults?: boolean;
    /** Built-in labels to disable (e.g. "todo marker"). */
    disableDefaults?: string[];
  };
  /** Exit with code 1 only when a reported issue meets `--fail-on` and this confidence floor. */
  failOnConfidence?: number;
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

export interface ScanSummary {
  totalIssues: number;
  bySeverity: Record<Severity, number>;
  byRule: Record<string, number>;
  filesScanned: number;
  rulesRun: number;
  elapsedMs: number;
  warnings?: string[];
}

export interface ScanResult {
  issues: DebtIssue[];
  summary: ScanSummary;
  options: Pick<ScanOptions, "target" | "include" | "exclude" | "minSeverity" | "rules">;
}
