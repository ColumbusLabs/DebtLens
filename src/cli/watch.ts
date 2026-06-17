import { spawnSync } from "node:child_process";
import { existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { dirname, resolve } from "node:path";

export interface WatchRunOptions {
  cwd: string;
  target: string;
  rawOptions: Record<string, unknown>;
  entrypoint?: string;
  execArgv?: string[];
}

export function buildWatchScanArgs(target: string, rawOptions: Record<string, unknown>): string[] {
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
  addBoolean(args, "--fail-on-regression", rawOptions.failOnRegression);
  addString(args, "--baseline", rawOptions.baseline);
  addOptionalValue(args, "--changed", rawOptions.changed);
  addBoolean(args, "--staged", rawOptions.staged);
  addBoolean(args, "--respect-gitignore", rawOptions.respectGitignore);
  addString(args, "--config", rawOptions.config);
  addString(args, "--cwd", rawOptions.cwd);
  addString(args, "--package", rawOptions.package);
  addBoolean(args, "--no-color", rawOptions.color === false);
  addBoolean(args, "--quiet", rawOptions.quiet);
  addBoolean(args, "--profile", rawOptions.profile);
  addOptionalValue(args, "--cache", rawOptions.cache);
  addBoolean(args, "--parallel", rawOptions.parallel);
  addValue(args, "--batch-size", rawOptions.batchSize);
  addBoolean(args, "--blame-age", rawOptions.blameAge);
  addString(args, "--group-by", rawOptions.groupBy);
  addBoolean(args, "--sarif-compact", rawOptions.sarifCompact);
  addOptionalValue(args, "--markdown-heatmap", rawOptions.markdownHeatmap);
  return args;
}

export function runWatch(options: WatchRunOptions): void {
  if (options.rawOptions.writeBaseline !== undefined) {
    throw new Error("watch does not support --write-baseline; run `debtlens scan --write-baseline` once instead.");
  }

  const scanArgs = buildWatchScanArgs(options.target, options.rawOptions);
  const execArgv = options.execArgv ?? process.execArgv;
  const entrypoint = options.entrypoint ?? process.argv[1];
  const runOnce = () => {
    const result = spawnSync(process.execPath, [...execArgv, entrypoint, ...scanArgs], {
      cwd: options.cwd,
      encoding: "utf8",
      env: process.env,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) process.stderr.write(`DebtLens watch failed: ${result.error.message}\n`);
    if (typeof result.status === "number" && result.status !== 0) {
      process.stderr.write(`DebtLens watch: scan exited with code ${result.status}; waiting for changes.\n`);
    }
  };

  runOnce();

  const watchRoot = resolveWatchRoot(options.cwd, options.target);
  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  const debounceMs = normalizeDebounce(options.rawOptions.debounce);
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      process.stdout.write("DebtLens watch: change detected; rescanning.\n");
      runOnce();
    }, debounceMs);
  };

  watchers.push(watch(watchRoot, { recursive: true }, schedule));
  const configPath = typeof options.rawOptions.config === "string"
    ? resolve(options.cwd, options.rawOptions.config)
    : resolve(options.cwd, "debtlens.config.json");
  if (existsSync(configPath) && dirname(configPath) !== watchRoot) {
    watchers.push(watch(configPath, schedule));
  }

  process.stdout.write(`DebtLens watch: watching ${watchRoot}\n`);

  const shutdown = () => {
    if (timer) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    process.stdout.write("DebtLens watch: stopped.\n");
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function resolveWatchRoot(cwd: string, target: string): string {
  const absoluteTarget = resolve(cwd, target);
  if (!existsSync(absoluteTarget)) return cwd;
  const stats = statSync(absoluteTarget);
  return stats.isDirectory() ? absoluteTarget : dirname(absoluteTarget);
}

function normalizeDebounce(value: unknown): number {
  if (value === undefined) return 250;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative debounce in milliseconds, received "${String(value)}".`);
  }
  return parsed;
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
    addString(args, flag, value);
  }
}
