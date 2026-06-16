import type { DebtIssue, DebtHeatmapEntry, DuplicateLogicCluster, RuleCorrelation, ScanCountSummary, Severity } from "./types.js";

export function summarizeIssues(issues: DebtIssue[]): ScanCountSummary {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  const byRule: Record<string, number> = {};
  for (const issue of issues) {
    bySeverity[issue.severity] += 1;
    byRule[issue.ruleId] = (byRule[issue.ruleId] ?? 0) + 1;
  }
  return { totalIssues: issues.length, bySeverity, byRule };
}

export function groupIssuesByFile(issues: DebtIssue[]): Array<[string, DebtIssue[]]> {
  const byFile = new Map<string, DebtIssue[]>();
  for (const issue of issues) {
    const group = byFile.get(issue.file);
    if (group) group.push(issue);
    else byFile.set(issue.file, [issue]);
  }
  return [...byFile.entries()].sort((left, right) => compareIssueGroups(left, right));
}

export function groupIssuesByRule(issues: DebtIssue[]): Array<[string, DebtIssue[]]> {
  const byRule = new Map<string, DebtIssue[]>();
  for (const issue of issues) {
    const group = byRule.get(issue.ruleId);
    if (group) group.push(issue);
    else byRule.set(issue.ruleId, [issue]);
  }
  return [...byRule.entries()].sort((left, right) => compareIssueGroups(left, right));
}

export function buildRuleCorrelations(issues: DebtIssue[]): RuleCorrelation[] {
  return groupIssuesByFile(issues)
    .map(([file, fileIssues]) => {
      const rules = groupIssuesByRule(fileIssues)
        .map(([ruleId, ruleIssues]) => ({
          ruleId,
          ruleName: ruleIssues[0]?.ruleName ?? ruleId,
          count: ruleIssues.length,
        }))
        .sort((left, right) => {
          const countDelta = right.count - left.count;
          if (countDelta !== 0) return countDelta;
          return left.ruleId.localeCompare(right.ruleId);
        });
      return { file, totalIssues: fileIssues.length, rules };
    })
    .filter((entry) => entry.rules.length >= 2)
    .sort((left, right) => {
      const issueDelta = right.totalIssues - left.totalIssues;
      if (issueDelta !== 0) return issueDelta;
      const ruleDelta = right.rules.length - left.rules.length;
      if (ruleDelta !== 0) return ruleDelta;
      return left.file.localeCompare(right.file);
    });
}

export function buildDebtHeatmap(issues: DebtIssue[], limit = 10): DebtHeatmapEntry[] {
  return groupIssuesByFile(issues)
    .map(([file, fileIssues]) => ({
      file,
      totalIssues: fileIssues.length,
      distinctRules: new Set(fileIssues.map((issue) => issue.ruleId)).size,
      bySeverity: summarizeIssues(fileIssues).bySeverity,
    }))
    .sort((left, right) => {
      const issueDelta = right.totalIssues - left.totalIssues;
      if (issueDelta !== 0) return issueDelta;
      const ruleDelta = right.distinctRules - left.distinctRules;
      if (ruleDelta !== 0) return ruleDelta;
      return left.file.localeCompare(right.file);
    })
    .slice(0, Math.max(0, limit));
}

export function buildDuplicateLogicClusters(issues: DebtIssue[]): DuplicateLogicCluster[] {
  const parent = new Map<string, string>();
  const locationByKey = new Map<string, DuplicateLogicCluster["locations"][number]>();
  const issueKeys: string[][] = [];

  for (const issue of issues) {
    if (issue.ruleId !== "duplicate-logic") continue;
    const locations = parseDuplicateLocations(issue);
    if (locations.length < 2) continue;
    const keys = locations.map(locationKey);
    issueKeys.push(keys);
    for (const location of locations) {
      const key = locationKey(location);
      parent.set(key, parent.get(key) ?? key);
      locationByKey.set(key, location);
    }
    const [firstKey, ...otherKeys] = keys;
    if (firstKey) {
      for (const key of otherKeys) {
        union(parent, firstKey, key);
      }
    }
  }

  const clusters = new Map<string, {
    issueCount: number;
    locations: Map<string, DuplicateLogicCluster["locations"][number]>;
  }>();
  for (const keys of issueKeys) {
    const root = find(parent, keys[0] ?? "");
    if (!root) continue;
    const cluster = clusters.get(root) ?? { issueCount: 0, locations: new Map() };
    cluster.issueCount += 1;
    for (const key of keys) {
      const location = locationByKey.get(key);
      if (location) cluster.locations.set(key, location);
    }
    clusters.set(root, cluster);
  }

  return [...clusters.values()]
    .filter((cluster) => cluster.locations.size >= 2)
    .map((cluster) => {
      const locations = [...cluster.locations.values()].sort(compareLocations);
      const clusterKey = locations.map(locationKey).join("|");
      return {
        clusterId: stableClusterId(clusterKey),
        issueCount: cluster.issueCount,
        locations,
      };
    })
    .sort((left, right) => {
      const countDelta = right.locations.length - left.locations.length;
      if (countDelta !== 0) return countDelta;
      return left.clusterId.localeCompare(right.clusterId);
    });
}

function compareIssueGroups(left: [string, DebtIssue[]], right: [string, DebtIssue[]]): number {
  const countDelta = right[1].length - left[1].length;
  if (countDelta !== 0) return countDelta;
  return left[0].localeCompare(right[0]);
}

function parseDuplicateLocations(issue: DebtIssue): DuplicateLogicCluster["locations"] {
  const locations = (issue.evidence ?? [])
    .map((evidence) => evidence.match(/^(.+):(\d+)-(\d+) \(/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      file: match[1],
      startLine: Number(match[2]),
      endLine: Number(match[3]),
    }))
    .filter((location) => location.file.length > 0 && Number.isFinite(location.startLine));
  if (locations.length > 0) return locations;
  if (!issue.location) return [];
  return [{
    file: issue.file,
    startLine: issue.location.startLine,
    endLine: issue.location.endLine,
  }];
}

function compareLocations(left: DuplicateLogicCluster["locations"][number], right: DuplicateLogicCluster["locations"][number]): number {
  const byFile = left.file.localeCompare(right.file);
  if (byFile !== 0) return byFile;
  return left.startLine - right.startLine;
}

function locationKey(location: DuplicateLogicCluster["locations"][number]): string {
  return `${location.file}:${location.startLine}`;
}

function find(parent: Map<string, string>, key: string): string {
  const current = parent.get(key);
  if (!current || current === key) return current ?? key;
  const root = find(parent, current);
  parent.set(key, root);
  return root;
}

function union(parent: Map<string, string>, left: string, right: string): void {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot !== rightRoot) {
    parent.set(rightRoot, leftRoot);
  }
}

function stableClusterId(key: string): string {
  let hash = 5381;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) + hash) ^ key.charCodeAt(index);
  }
  return `dup_${(hash >>> 0).toString(36)}`;
}
