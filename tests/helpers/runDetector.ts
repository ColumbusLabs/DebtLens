import { Project, ScriptTarget, ts } from "ts-morph";
import { parseSourceFile } from "../../src/core/languages.js";
import type { DebtIssue, Detector, ScanOptions, ScanThresholds, Severity, SourceFileInfo, SourceLanguage } from "../../src/core/types.js";
import { compileTodoCommentMarkers } from "../../src/detectors/todoComment.js";

export interface RunDetectorOptions {
  /** Absolute scan target for detectors that read config from disk. */
  target?: string;
  /** Threshold overrides, e.g. `{ "state-sprawl.maxStatefulHooks": 6 }`. */
  thresholds?: ScanThresholds;
  /** Minimum severity passed through on the synthetic ScanOptions. */
  minSeverity?: ScanOptions["minSeverity"];
  /** Naming-drift vocabulary override. */
  vocabulary?: Record<string, string[]>;
  /** Naming-drift: skip built-in concept groups. */
  namingDriftDisableBuiltInVocabulary?: boolean;
  /** Prop-drilling custom ignore components. */
  propDrillingIgnoreComponents?: string[];
  /** Duplicated-literal custom string ignores. */
  duplicatedLiteralIgnoreStrings?: string[];
  /** Todo-comment: replace built-in marker patterns. */
  todoCommentReplaceDefaults?: boolean;
  /** Todo-comment: built-in marker labels to disable. */
  todoCommentDisableDefaults?: string[];
  /** Todo-comment: custom marker patterns. */
  todoCommentMarkers?: Array<{ pattern: string; severity?: Severity; label?: string }>;
  /** Override inferred source language for all files. */
  language?: SourceLanguage;
}

function inferSourceLanguage(relativePath: string, override?: SourceLanguage): SourceLanguage {
  if (override) return override;
  if (relativePath.endsWith(".kt") || relativePath.endsWith(".kts")) return "kotlin";
  if (relativePath.endsWith(".swift")) return "swift";
  if (relativePath.endsWith(".rb")) return "ruby";
  if (relativePath.endsWith(".vue")) return "vue";
  if (relativePath.endsWith(".svelte")) return "svelte";
  return relativePath.endsWith(".py") ? "python" : "tsjs";
}

/**
 * Run a single detector against in-memory source files.
 *
 * `files` maps a relative path to file contents. Use a `.tsx` extension for any
 * file containing JSX so ts-morph parses it correctly.
 */
export async function runDetector(
  detector: Detector,
  files: Record<string, string>,
  options: RunDetectorOptions = {},
): Promise<DebtIssue[]> {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.ReactJSX,
      target: ScriptTarget.ES2022,
      skipLibCheck: true,
    },
  });

  const sourceFiles: SourceFileInfo[] = [];
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = `/${relativePath}`;
    const language = inferSourceLanguage(relativePath, options.language);
    sourceFiles.push(parseSourceFile({
      project,
      absolutePath,
      relativePath,
      content,
      language,
    }));
  }

  const thresholds = options.thresholds ?? {};
  const scanOptions: ScanOptions = {
    cwd: "/",
    target: options.target ?? ".",
    include: [],
    exclude: [],
    minSeverity: options.minSeverity ?? "info",
    thresholds,
    rules: undefined,
    maxFiles: undefined,
    vocabulary: options.vocabulary,
    namingDriftDisableBuiltInVocabulary: options.namingDriftDisableBuiltInVocabulary,
    propDrillingIgnoreComponents: options.propDrillingIgnoreComponents,
    duplicatedLiteralIgnoreStrings: options.duplicatedLiteralIgnoreStrings,
    todoCommentReplaceDefaults: options.todoCommentReplaceDefaults,
    todoCommentDisableDefaults: options.todoCommentDisableDefaults,
    todoCommentMarkers: options.todoCommentMarkers
      ? compileTodoCommentMarkers(options.todoCommentMarkers)
      : undefined,
  };

  const issues = await detector.detect({
    project,
    files: sourceFiles,
    options: scanOptions,
    getThreshold: (key, fallback) =>
      Number.isFinite(thresholds[key]) ? (thresholds[key] as number) : fallback,
    addWarning: () => undefined,
  });

  return issues;
}
