import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DebtLensConfig } from "../core/types.js";
import { renderConfigFile } from "../config/template.js";

interface EslintConfigLike {
  rules?: Record<string, unknown>;
}

export function suggestConfigFromEslint(cwd: string, configPath: string): string {
  const absolutePath = resolve(cwd, configPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`ESLint config not found at ${absolutePath}.`);
  }

  const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as EslintConfigLike | EslintConfigLike[];
  const rules = mergeEslintRules(Array.isArray(parsed) ? parsed : [parsed]);
  const thresholdOverrides = buildThresholdOverrides(rules);
  const pack = inferPack(rules);
  const rendered = JSON.parse(renderConfigFile(pack, thresholdOverrides)) as DebtLensConfig & { $schema?: string };

  if (!pack && (rules["complexity"] !== undefined || rules["max-depth"] !== undefined)) {
    rendered.rules = unique([...(rendered.rules ?? []), "complex-control-flow"]);
  }
  if (!pack && rules["max-lines-per-function"] !== undefined) {
    rendered.rules = unique([...(rendered.rules ?? []), "large-function"]);
  }

  return `${JSON.stringify(rendered, null, 2)}\n`;
}

function mergeEslintRules(configs: EslintConfigLike[]): Record<string, unknown> {
  const rules: Record<string, unknown> = {};
  for (const config of configs) {
    if (config?.rules && typeof config.rules === "object") {
      Object.assign(rules, config.rules);
    }
  }
  return rules;
}

function inferPack(rules: Record<string, unknown>): string | undefined {
  if (Object.keys(rules).some((rule) => rule.startsWith("@next/next/"))) return "next";
  if (Object.keys(rules).some((rule) => rule.startsWith("react/") || rule.startsWith("react-hooks/"))) return "react";
  return undefined;
}

function buildThresholdOverrides(rules: Record<string, unknown>): Record<string, number> {
  const thresholds: Record<string, number> = {};
  const complexity = numericRuleOption(rules["complexity"]);
  if (complexity !== undefined) {
    thresholds["complex-control-flow.maxComplexity"] = complexity;
  }

  const maxDepth = numericRuleOption(rules["max-depth"]);
  if (maxDepth !== undefined) {
    thresholds["complex-control-flow.maxDepth"] = maxDepth;
  }

  const maxLinesPerFunction = numericRuleOption(rules["max-lines-per-function"], "max");
  if (maxLinesPerFunction !== undefined) {
    thresholds["large-function.maxLines"] = maxLinesPerFunction;
  }

  const maxLines = numericRuleOption(rules["max-lines"], "max");
  if (maxLines !== undefined) {
    thresholds["large-component.maxLines"] = maxLines;
  }

  return thresholds;
}

function numericRuleOption(rule: unknown, key?: string): number | undefined {
  const options = Array.isArray(rule) ? rule.slice(1) : [rule];
  for (const option of options) {
    if (typeof option === "number" && Number.isFinite(option)) return option;
    if (key && option && typeof option === "object") {
      const value = (option as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
