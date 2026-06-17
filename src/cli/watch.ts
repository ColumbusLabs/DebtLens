import chokidar from "chokidar";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findConfigPath } from "../config/loadConfig.js";
import { spawnCliSync } from "../utils/spawn.js";
import { buildScanArgv } from "./argv.js";

export interface WatchRunOptions {
  cwd: string;
  target: string;
  rawOptions: Record<string, unknown>;
  entrypoint?: string;
  execArgv?: string[];
}

export function runWatch(options: WatchRunOptions): void {
  if (options.rawOptions.writeBaseline !== undefined) {
    throw new Error("watch does not support --write-baseline; run `debtlens scan --write-baseline` once instead.");
  }

  const scanArgs = buildScanArgv(options.target, options.rawOptions);
  const execArgv = options.execArgv ?? process.execArgv;
  const entrypoint = options.entrypoint ?? process.argv[1];
  const runOnce = () => {
    const result = spawnCliSync(scanArgs, {
      cwd: options.cwd,
      entrypoint,
      execArgv,
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
  const watchPaths: string[] = [watchRoot];
  const configPath = findConfigPath(
    options.cwd,
    typeof options.rawOptions.config === "string" ? options.rawOptions.config : undefined,
  );
  if (configPath && dirname(configPath) !== watchRoot) {
    watchPaths.push(configPath);
  }

  let timer: NodeJS.Timeout | undefined;
  const debounceMs = normalizeDebounce(options.rawOptions.debounce);
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      process.stdout.write("DebtLens watch: change detected; rescanning.\n");
      runOnce();
    }, debounceMs);
  };

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    persistent: true,
  });
  watcher.on("all", schedule);

  process.stdout.write(`DebtLens watch: watching ${watchRoot}\n`);

  const shutdown = () => {
    if (timer) clearTimeout(timer);
    void watcher.close();
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
