import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { ts } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../core/types.js";
import { buildChangedPathScope, isChangedPath, isSourceFileChanged } from "../utils/changedScope.js";
import { createIssue } from "../utils/createIssue.js";

interface DriftValue {
  file: string;
  value: string;
  changed: boolean;
}

interface ConfigFile {
  relativePath: string;
  content: string;
  changed: boolean;
}

export const configDriftDetector: Detector = {
  id: "config-drift",
  name: "Config drift",
  description: "Flags conflicting repeated values across JSON config files without executing JS config.",
  defaultSeverity: "medium",
  tags: ["config", "maintainability", "monorepo"],
  detect(context: DetectorContext): DebtIssue[] {
    const values = new Map<string, DriftValue[]>();
    const maxConfigFiles = context.getThreshold("config-drift.maxConfigFiles", 200);
    const changedScoped = context.options.changedFiles !== undefined;

    for (const file of collectConfigFiles(context, maxConfigFiles)) {
      const parsed = parseJsonConfig(file.relativePath, file.content);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      collectPackageScripts(values, file, parsed);
      collectTsConfigOptions(values, file, parsed);
      collectArrayField(values, file, parsed, "include");
      collectArrayField(values, file, parsed, "exclude");
    }

    const issues: DebtIssue[] = [];
    for (const [key, entries] of values) {
      const distinct = new Map(entries.map((entry) => [entry.value, entry]));
      if (entries.length < 2 || distinct.size < 2) continue;
      const first = changedScoped
        ? entries.find((entry) => entry.changed)
        : entries[0];
      if (!first) continue;
      issues.push(createIssue({
        detector: configDriftDetector,
        severity: distinct.size > 2 ? "high" : "medium",
        confidence: 0.78,
        file: first.file,
        location: { startLine: 1 },
        message: `${key} has conflicting values across JSON config files.`,
        evidence: entries.map((entry) => `${entry.file}: ${entry.value}`),
        suggestion: "Consolidate shared config in one base file or document why each package needs a different value.",
      }));
    }

    return issues.slice(0, 50);
  },
};

function isJsonConfig(path: string): boolean {
  const name = basename(path);
  return name === "package.json"
    || /^tsconfig(?:\..+)?\.json$/.test(name)
    || name === ".eslintrc.json"
    || name === "eslint.config.json";
}

function collectConfigFiles(
  context: DetectorContext,
  maxConfigFiles: number,
): ConfigFile[] {
  const changedScope = buildChangedPathScope(context.options);
  const existing = context.files
    .filter((file) => isJsonConfig(file.relativePath))
    .map((file) => ({
      relativePath: file.relativePath,
      content: file.content,
      changed: isSourceFileChanged(changedScope, file),
    }))
    .slice(0, maxConfigFiles);
  if (existing.length >= maxConfigFiles) return existing;

  const seen = new Set(existing.map((file) => file.relativePath));

  if (!isAbsolute(context.options.target) || !existsSync(context.options.target)) return existing;
  const stats = statSync(context.options.target);
  const absolutePaths = stats.isFile()
    ? [context.options.target]
    : collectConfigPaths(context.options.target, context.options.exclude, maxConfigFiles - existing.length);

  for (const absolutePath of absolutePaths) {
    if (existing.length >= maxConfigFiles) break;
    const relativePath = stats.isFile()
      ? basename(absolutePath)
      : relative(context.options.target, absolutePath).replaceAll("\\", "/");
    if (seen.has(relativePath) || !isJsonConfig(relativePath)) continue;
    seen.add(relativePath);
    existing.push({
      relativePath,
      content: readFileSync(resolve(absolutePath), "utf8"),
      changed: isChangedPath(changedScope, relativePath, absolutePath),
    });
  }

  return existing;
}

function collectConfigPaths(root: string, exclude: string[], limit: number): string[] {
  const paths: string[] = [];

  const visit = (directory: string) => {
    if (paths.length >= limit) return;

    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (paths.length >= limit) break;
      const absolutePath = resolve(directory, entry.name);
      const relativePath = relative(root, absolutePath).replaceAll("\\", "/");
      if (isExcluded(relativePath, exclude)) continue;

      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && isJsonConfig(relativePath)) {
        paths.push(absolutePath);
      }
    }
  };

  visit(root);
  return paths;
}

function isExcluded(path: string, exclude: string[]): boolean {
  return exclude.some((glob) => {
    if (glob.endsWith("/**") && path === glob.slice(0, -3)) return true;
    return globMatches(path, glob);
  });
}

function globMatches(path: string, glob: string): boolean {
  let expression = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      expression += ".*";
      index += 1;
    } else if (char === "*") {
      expression += "[^/]*";
    } else {
      expression += escapeRegExp(char ?? "");
    }
  }
  return new RegExp(`^${expression}$`).test(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function parseJsonConfig(file: string, content: string): unknown {
  const parsed = ts.parseConfigFileTextToJson(file, content);
  return parsed.error ? undefined : parsed.config;
}

function collectPackageScripts(values: Map<string, DriftValue[]>, file: ConfigFile, parsed: object): void {
  if (basename(file.relativePath) !== "package.json") return;
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return;
  for (const [scriptName, command] of Object.entries(scripts)) {
    if (typeof command === "string") {
      pushValue(values, `package.json scripts.${scriptName}`, file, command);
    }
  }
}

function collectTsConfigOptions(values: Map<string, DriftValue[]>, file: ConfigFile, parsed: object): void {
  if (!/^tsconfig(?:\..+)?\.json$/.test(basename(file.relativePath))) return;
  const compilerOptions = (parsed as { compilerOptions?: unknown }).compilerOptions;
  if (!compilerOptions || typeof compilerOptions !== "object" || Array.isArray(compilerOptions)) return;
  for (const optionName of ["target", "module", "jsx", "strict", "moduleResolution"]) {
    const value = (compilerOptions as Record<string, unknown>)[optionName];
    if (value !== undefined) {
      pushValue(values, `tsconfig compilerOptions.${optionName}`, file, JSON.stringify(value));
    }
  }
}

function collectArrayField(values: Map<string, DriftValue[]>, file: ConfigFile, parsed: object, key: "include" | "exclude"): void {
  const value = (parsed as Record<string, unknown>)[key];
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    pushValue(values, `${basename(file.relativePath)} ${key}`, file, JSON.stringify([...value].sort()));
  }
}

function pushValue(values: Map<string, DriftValue[]>, key: string, file: ConfigFile, value: string): void {
  const entries = values.get(key) ?? [];
  entries.push({ file: file.relativePath, value, changed: file.changed });
  values.set(key, entries);
}
