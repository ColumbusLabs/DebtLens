export const SCAN_ARG_FLAGS = [
  "--include",
  "--exclude",
  "--min-severity",
  "--pack",
  "--rules",
  "--threshold",
  "--max-files",
  "--format",
  "--output",
  "--fail-on",
  "--fail-on-confidence",
  "--gate",
  "--fail-on-regression",
  "--baseline",
  "--diff-base",
  "--write-baseline",
  "--changed",
  "--staged",
  "--respect-gitignore",
  "--config",
  "--cwd",
  "--package",
  "--no-color",
  "--quiet",
  "--profile",
  "--audit-suppressions",
  "--cache",
  "--parallel",
  "--batch-size",
  "--blame-age",
  "--hotspots",
  "--churn-days",
  "--churn-range",
  "--ownership",
  "--codeowners",
  "--group-by",
  "--sarif-compact",
  "--sarif-category",
  "--junit-fail-on",
  "--markdown-heatmap",
  "--top",
] as const;

export function buildScanArgv(target: string, rawOptions: Record<string, unknown>): string[] {
  const args = ["scan", target];
  addString(args, "--include", rawOptions.include);
  addString(args, "--exclude", rawOptions.exclude);
  addString(args, "--min-severity", rawOptions.minSeverity);
  addString(args, "--pack", rawOptions.pack);
  addString(args, "--rules", rawOptions.rules);
  addString(args, "--threshold", rawOptions.threshold);
  addValue(args, "--max-files", rawOptions.maxFiles);
  addString(args, "--format", rawOptions.format);
  addString(args, "--output", rawOptions.output);
  addString(args, "--fail-on", rawOptions.failOn);
  addValue(args, "--fail-on-confidence", rawOptions.failOnConfidence);
  addString(args, "--gate", rawOptions.gate);
  addBoolean(args, "--fail-on-regression", rawOptions.failOnRegression);
  addString(args, "--baseline", rawOptions.baseline);
  addString(args, "--diff-base", rawOptions.diffBase);
  addOptionalValue(args, "--write-baseline", rawOptions.writeBaseline);
  addOptionalValue(args, "--changed", rawOptions.changed);
  addBoolean(args, "--staged", rawOptions.staged);
  addBoolean(args, "--respect-gitignore", rawOptions.respectGitignore);
  addString(args, "--config", rawOptions.config);
  addString(args, "--cwd", rawOptions.cwd);
  addString(args, "--package", rawOptions.package);
  addBoolean(args, "--no-color", rawOptions.color === false);
  addBoolean(args, "--quiet", rawOptions.quiet);
  addBoolean(args, "--profile", rawOptions.profile);
  addBoolean(args, "--audit-suppressions", rawOptions.auditSuppressions);
  addOptionalValue(args, "--cache", rawOptions.cache);
  addBoolean(args, "--parallel", rawOptions.parallel);
  addValue(args, "--batch-size", rawOptions.batchSize);
  addBoolean(args, "--blame-age", rawOptions.blameAge);
  addOptionalValue(args, "--hotspots", rawOptions.hotspots);
  addValue(args, "--churn-days", rawOptions.churnDays);
  addString(args, "--churn-range", rawOptions.churnRange);
  addBoolean(args, "--ownership", rawOptions.ownership);
  addString(args, "--codeowners", rawOptions.codeowners);
  addString(args, "--group-by", rawOptions.groupBy);
  addBoolean(args, "--sarif-compact", rawOptions.sarifCompact);
  addString(args, "--sarif-category", rawOptions.sarifCategory);
  addString(args, "--junit-fail-on", rawOptions.junitFailOn);
  addOptionalValue(args, "--markdown-heatmap", rawOptions.markdownHeatmap);
  addValue(args, "--top", rawOptions.top);
  return args;
}

export function buildDoctorArgv(target: string, rawOptions: Record<string, unknown>): string[] {
  const args = ["doctor", target];
  addString(args, "--include", rawOptions.include);
  addString(args, "--exclude", rawOptions.exclude);
  addString(args, "--min-severity", rawOptions.minSeverity);
  addString(args, "--pack", rawOptions.pack);
  addString(args, "--rules", rawOptions.rules);
  addValue(args, "--max-files", rawOptions.maxFiles);
  addString(args, "--gate", rawOptions.gate);
  addString(args, "--baseline", rawOptions.baseline);
  addOptionalValue(args, "--changed", rawOptions.changed);
  addBoolean(args, "--staged", rawOptions.staged);
  addBoolean(args, "--respect-gitignore", rawOptions.respectGitignore);
  addString(args, "--config", rawOptions.config);
  addString(args, "--cwd", rawOptions.cwd);
  addString(args, "--package", rawOptions.package);
  return args;
}

function addString(args: string[], flag: string, value: unknown): void {
  if (typeof value === "string" && value.length > 0) args.push(flag, value);
}

function addValue(args: string[], flag: string, value: unknown): void {
  if (typeof value === "number" || typeof value === "string") args.push(flag, String(value));
}

function addBoolean(args: string[], flag: string, value: unknown): void {
  if (value === true) args.push(flag);
}

function addOptionalValue(args: string[], flag: string, value: unknown): void {
  if (value === true) {
    args.push(flag);
  } else {
    addValue(args, flag, value);
  }
}
