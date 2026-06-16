import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRulePack } from "../config/packs.js";
import { renderConfigFile } from "../config/template.js";

export const CONFIG_FILENAME = "debtlens.config.json";

export interface InitResult {
  path: string;
  overwritten: boolean;
}

/**
 * Write a starter `debtlens.config.json` into `cwd`. Refuses to clobber an existing
 * config unless `force` is set.
 */
export function runInit(
  cwd: string,
  force = false,
  pack?: string,
  thresholdOverrides: Record<string, number> = {},
): InitResult {
  const path = resolve(cwd, CONFIG_FILENAME);
  const exists = existsSync(path);

  if (exists && !force) {
    throw new Error(`${CONFIG_FILENAME} already exists. Pass --force to overwrite it.`);
  }

  if (pack) {
    getRulePack(pack);
  }

  writeFileSync(path, renderConfigFile(pack, thresholdOverrides), "utf8");
  return { path, overwritten: exists };
}
