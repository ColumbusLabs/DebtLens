import type { Project, SourceFile } from "ts-morph";

export type Severity = "info" | "low" | "medium" | "high";
export type OutputFormat = "terminal" | "json" | "markdown" | "sarif";

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
  rules?: string[];
  thresholds?: ScanThresholds;
  maxFiles?: number;
  /** Concept id -> competing term variants, used by the naming-drift rule. */
  vocabulary?: Record<string, string[]>;
  /** Prop-drilling rule configuration. */
  propDrilling?: {
    ignoreComponents?: string[];
  };
}

export interface ScanOptions {
  cwd: string;
  target: string;
  include: string[];
  exclude: string[];
  minSeverity: Severity;
  rules?: string[];
  thresholds: ScanThresholds;
  maxFiles?: number;
  vocabulary?: Record<string, string[]>;
  /** When set, only scan files whose absolute path is in this list (--changed mode). */
  changedFiles?: string[];
  /** Prop-drilling rule configuration. */
  propDrillingIgnoreComponents?: string[];
}

export interface CliOptions {
  cwd?: string;
  include?: string[];
  exclude?: string[];
  minSeverity?: Severity;
  rules?: string[];
  thresholds?: ScanThresholds;
  maxFiles?: number;
  format?: OutputFormat;
  output?: string;
  failOn?: Severity;
  configPath?: string;
  noColor?: boolean;
  changedFiles?: string[];
}

export interface DetectorContext {
  project: Project;
  files: SourceFileInfo[];
  options: ScanOptions;
  getThreshold: (key: string, fallback: number) => number;
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
}

export interface ScanResult {
  issues: DebtIssue[];
  summary: ScanSummary;
  options: Pick<ScanOptions, "target" | "include" | "exclude" | "minSeverity" | "rules">;
}
