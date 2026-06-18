import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export const LARGE_OUTPUT_MAX_BUFFER = 64 * 1024 * 1024;

export interface SpawnCliOptions {
  cwd?: string;
  entrypoint?: string;
  execArgv?: string[];
}

export function spawnCliSync(cliArgs: string[], options: SpawnCliOptions = {}): SpawnSyncReturns<string> {
  const execArgv = options.execArgv ?? process.execArgv;
  const entrypoint = options.entrypoint ?? process.argv[1];
  return spawnSync(process.execPath, [...execArgv, entrypoint, ...cliArgs], {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: LARGE_OUTPUT_MAX_BUFFER,
  });
}
