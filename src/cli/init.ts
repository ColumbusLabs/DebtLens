import { existsSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { getRulePack } from "../config/packs.js";
import { renderConfigFile } from "../config/template.js";

export const CONFIG_FILENAME = "debtlens.config.json";

export interface InitResult {
  path: string;
  overwritten: boolean;
}

const DEFAULT_POLICY_PLUGIN_ENTRYPOINT = "rules/index.mjs";

/**
 * Write a starter `debtlens.config.json` into `cwd`. Refuses to clobber an existing
 * config unless `force` is set.
 */
export function runInit(
  cwd: string,
  force = false,
  pack?: string,
  thresholdOverrides: Record<string, number> = {},
  policy?: string,
): InitResult {
  const path = resolve(cwd, CONFIG_FILENAME);
  const exists = existsSync(path);

  if (exists && !force) {
    throw new Error(`${CONFIG_FILENAME} already exists. Pass --force to overwrite it.`);
  }

  if (pack) {
    getRulePack(pack);
  }

  const policyPluginPath = policy ? resolvePolicyPluginPath(cwd, policy) : undefined;
  writeFileSync(path, renderConfigFile(pack, thresholdOverrides, policyPluginPath), "utf8");
  return { path, overwritten: exists };
}

function resolvePolicyPluginPath(cwd: string, policy: string): string {
  const trimmed = policy.trim();
  if (trimmed.length === 0) {
    throw new Error("--policy requires a package name or local plugin module path.");
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new Error("--policy must be an installed package name or local file path, not a URL.");
  }

  if (isLocalPolicyPath(trimmed)) {
    const absolutePath = resolve(cwd, trimmed);
    const relativeToConfig = relative(cwd, absolutePath);
    if (relativeToConfig.startsWith("..") || isAbsolute(relativeToConfig)) {
      throw new Error(`Policy path "${policy}" resolves outside the config directory.`);
    }

    const pluginPath = isAbsolute(trimmed) ? `./${relativeToConfig.replaceAll("\\", "/")}` : trimmed;
    return verifyPolicyModulePath(cwd, pluginPath, policy);
  }

  return verifyPolicyModulePath(cwd, `./node_modules/${resolvePackagePolicyEntrypoint(trimmed)}`, policy);
}

function isLocalPolicyPath(policy: string): boolean {
  return policy.startsWith(".") || isAbsolute(policy);
}

function resolvePackagePolicyEntrypoint(policy: string): string {
  const parts = policy.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error("--policy requires a package name or local plugin module path.");
  }
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error(`Policy package "${policy}" must not contain relative path segments.`);
  }

  if (parts[0]?.startsWith("@")) {
    if (parts.length < 2) {
      throw new Error(`Policy package "${policy}" must include a scoped package name, such as @org/debtlens-policy.`);
    }
    const packageName = `${parts[0]}/${parts[1]}`;
    const subpath = parts.slice(2).join("/");
    return subpath ? `${packageName}/${subpath}` : `${packageName}/${DEFAULT_POLICY_PLUGIN_ENTRYPOINT}`;
  }

  const packageName = parts[0]!;
  const subpath = parts.slice(1).join("/");
  return subpath ? `${packageName}/${subpath}` : `${packageName}/${DEFAULT_POLICY_PLUGIN_ENTRYPOINT}`;
}

function verifyPolicyModulePath(cwd: string, pluginPath: string, policy: string): string {
  const absolutePath = resolve(cwd, pluginPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Policy module "${policy}" was not found at ${absolutePath}. Install the package or pass a local file path.`);
  }
  if (!statSync(absolutePath).isFile()) {
    throw new Error(`Policy module "${policy}" must resolve to a file, not a directory.`);
  }
  return pluginPath;
}
