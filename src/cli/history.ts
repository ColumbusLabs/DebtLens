import { resolve } from "node:path";
import { loadEffectiveConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { appendHistoryEntry, buildHistoryEntry, getHistoryPath, readHistoryEntries } from "../core/history.js";
import { scan } from "../core/scan.js";
import { getCurrentGitSha } from "../utils/git.js";
import type { ScanResult } from "../core/types.js";
import { loadConfiguredPlugins } from "./scanPipeline.js";
import { parseCommaList, parseInteger, parseRuleList, parseThresholds } from "./parse.js";
import { parseSeverity } from "../core/severity.js";

export interface HistoryRecordInput {
  target: string;
  cwd: string;
  configPath?: string;
  historyPath?: string;
  once?: boolean;
  cliOptions?: Record<string, unknown>;
}

export async function runHistoryRecord(input: HistoryRecordInput): Promise<{ result: ScanResult; appended: boolean; path: string }> {
  const cwd = resolve(input.cwd);
  const effectiveConfig = loadEffectiveConfig(cwd, input.configPath);
  const pluginContribution = await loadConfiguredPlugins(cwd, input.cliOptions ?? {}, effectiveConfig.config, effectiveConfig.pluginConfigDir);
  const options = mergeConfig(input.target, effectiveConfig.config, {
    cwd,
    include: parseCommaList(input.cliOptions?.include as string | undefined),
    exclude: parseCommaList(input.cliOptions?.exclude as string | undefined),
    rules: parseRuleList(input.cliOptions?.rules as string | undefined),
    pack: input.cliOptions?.pack ? String(input.cliOptions.pack) : undefined,
    thresholds: parseThresholds(input.cliOptions?.threshold as string | undefined),
    minSeverity: parseSeverity(String(input.cliOptions?.minSeverity ?? "low"), "low"),
    pluginDetectors: pluginContribution?.detectors,
    pluginThresholds: pluginContribution?.thresholds,
    pluginVocabulary: pluginContribution?.vocabulary,
  });
  const result = await scan(options);
  const historyPath = getHistoryPath(cwd, input.historyPath);
  const entry = buildHistoryEntry(result, getCurrentGitSha(cwd));
  const { appended, path } = appendHistoryEntry(historyPath, entry, { once: input.once });
  return { result, appended, path };
}

export function runHistoryShow(cwd: string, options: {
  historyPath?: string;
  since?: string;
  limit?: number;
}): ReturnType<typeof readHistoryEntries> {
  const historyPath = getHistoryPath(resolve(cwd), options.historyPath);
  return readHistoryEntries(historyPath, { since: options.since, limit: options.limit });
}
