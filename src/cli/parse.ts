import { readFileSync } from "node:fs";
import type { CompletionShell } from "./completions.js";
import type { OutputFormat, TerminalGroupBy } from "../core/types.js";

export function parseCommaList(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const parsed = values
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

export function parseThresholds(value: string | undefined): Record<string, number> | undefined {
  if (!value) return undefined;
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  const result: Record<string, number> = {};

  for (const entry of entries) {
    const [key, rawValue] = entry.split("=").map((part) => part.trim());
    if (!key || !rawValue) {
      throw new Error(`Invalid threshold "${entry}". Use key=value, for example large-component.maxLines=300.`);
    }
    const numberValue = Number(rawValue);
    if (!Number.isFinite(numberValue)) {
      throw new Error(`Invalid numeric threshold value in "${entry}".`);
    }
    result[key] = numberValue;
  }

  return result;
}

export function parseRuleList(value: string | undefined): string[] | undefined {
  const parsed = parseCommaList(value);
  if (!parsed) return undefined;
  const aliases: Record<string, string> = {
    components: "large-component",
    component: "large-component",
    state: "state-sprawl",
    effects: "effect-complexity",
    effect: "effect-complexity",
    duplicates: "duplicate-logic",
    duplicate: "duplicate-logic",
    abstractions: "dead-abstraction",
    abstraction: "dead-abstraction",
    props: "prop-drilling",
    comments: "todo-comment",
    todos: "todo-comment",
    naming: "naming-drift",
  };
  return parsed.map((rule) => aliases[rule] ?? rule);
}

export function parseInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }
  return parsed;
}

export function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received "${value}".`);
  }
  return parsed;
}

export function parseOptionalInteger(value: string | boolean): number | true {
  if (value === true) return true;
  return parseInteger(String(value));
}

export function normalizeOptionalLimit(value: unknown, defaultValue: number): number | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) return defaultValue;
  return value as number;
}

export function parseConfidence(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Expected a confidence between 0 and 1, received "${value}".`);
  }
  return parsed;
}

export function parseFormat(value: string): OutputFormat {
  if (value === "terminal" || value === "json" || value === "markdown" || value === "pr-comment" || value === "sarif" || value === "html" || value === "junit" || value === "gitlab-codequality") return value;
  throw new Error(`Invalid format "${value}". Expected terminal, json, markdown, pr-comment, sarif, html, junit, or gitlab-codequality.`);
}

export function parseGroupBy(value: string): TerminalGroupBy {
  if (value === "severity" || value === "rule" || value === "file") return value;
  throw new Error(`Invalid group "${value}". Expected severity, rule, or file.`);
}

export function parseAdoptFormat(value: string): "terminal" | "markdown" {
  if (value === "terminal" || value === "markdown") return value;
  throw new Error(`Invalid adopt format "${value}". Expected terminal or markdown.`);
}

export function parseCompareFormat(value: string): "terminal" | "markdown" | "json" {
  if (value === "terminal" || value === "markdown" || value === "json") return value;
  throw new Error(`Invalid compare format "${value}". Expected terminal, markdown, or json.`);
}

export function getGitHubSourceUrlBase(env: NodeJS.ProcessEnv): string | undefined {
  const serverUrl = env.GITHUB_SERVER_URL;
  const source = getGitHubSource(env);
  const repository = source.repository ?? env.GITHUB_REPOSITORY;
  const sha = source.sha ?? env.GITHUB_SHA;
  if (!serverUrl || !repository || !sha) return undefined;
  return `${serverUrl.replace(/\/+$/, "")}/${repository}/blob/${sha}`;
}

function getGitHubSource(env: NodeJS.ProcessEnv): { repository?: string; sha?: string } {
  return readPullRequestHeadSource(env.GITHUB_EVENT_PATH);
}

function readPullRequestHeadSource(eventPath: string | undefined): { repository?: string; sha?: string } {
  if (!eventPath) return {};
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
      pull_request?: { head?: { repo?: { full_name?: unknown }; sha?: unknown } };
    };
    const repository = event.pull_request?.head?.repo?.full_name;
    const sha = event.pull_request?.head?.sha;
    return {
      repository: typeof repository === "string" && repository.length > 0 ? repository : undefined,
      sha: typeof sha === "string" && sha.length > 0 ? sha : undefined,
    };
  } catch {
    return {};
  }
}

export function parseRulesFormat(value: string): "terminal" | "json" {
  if (value === "terminal" || value === "json") return value;
  throw new Error(`Invalid rules format "${value}". Expected terminal or json.`);
}

export function parseCompletionShell(value: string): CompletionShell {
  if (value === "bash" || value === "zsh" || value === "fish") return value;
  throw new Error(`Invalid completion shell "${value}". Expected bash, zsh, or fish.`);
}

export function renderRulesTable(rules: Array<{ id: string; name: string; defaultSeverity: string; description: string }>): string {
  const idWidth = Math.max("Rule".length, ...rules.map((rule) => rule.id.length));
  const severityWidth = Math.max("Severity".length, ...rules.map((rule) => rule.defaultSeverity.length));
  const lines = [
    `${"Rule".padEnd(idWidth)}  ${"Severity".padEnd(severityWidth)}  Description`,
    `${"-".repeat(idWidth)}  ${"-".repeat(severityWidth)}  -----------`,
    ...rules.map((rule) => `${rule.id.padEnd(idWidth)}  ${rule.defaultSeverity.padEnd(severityWidth)}  ${rule.description}`),
  ];

  return `${lines.join("\n")}\n`;
}

export function renderPacksTable(packs: Array<{ id: string; description: string; rules: string[] }>): string {
  const idWidth = Math.max("Pack".length, ...packs.map((pack) => pack.id.length));
  const lines = [
    `${"Pack".padEnd(idWidth)}  Rules  Description`,
    `${"-".repeat(idWidth)}  -----  -----------`,
    ...packs.map((pack) => `${pack.id.padEnd(idWidth)}  ${String(pack.rules.length).padEnd(5)}  ${pack.description}`),
  ];

  return `${lines.join("\n")}\n`;
}

export function formatProfileReport(ruleTimingsMs: Record<string, number>): string {
  const lines = ["DebtLens profile (per-rule ms):"];
  for (const [ruleId, elapsedMs] of Object.entries(ruleTimingsMs).sort((left, right) => right[1] - left[1])) {
    lines.push(`  ${ruleId}: ${elapsedMs}ms`);
  }
  return `${lines.join("\n")}\n`;
}
