import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { buildFixTargets, groupIssuesByRule, summarizeIssues } from "./issueAggregates.js";
import type {
  CodeownersFile,
  CodeownersRule,
  DebtIssue,
  DuplicateLogicCluster,
  FixTarget,
  OwnershipFileSummary,
  OwnershipHandoff,
  OwnershipOwnerSummary,
  ScanHotspotSummary,
  ScanOwnershipSummary,
  Severity,
} from "./types.js";

const maxCodeownersSizeBytes = 3 * 1024 * 1024;

const severityWeight: Record<Severity, number> = {
  high: 16,
  medium: 8,
  low: 3,
  info: 1,
};

export interface BuildOwnershipSummaryInput {
  issues: DebtIssue[];
  codeowners?: CodeownersFile;
  rules?: CodeownersRule[];
  codeownersPath?: string;
  root?: string;
  warnings?: string[];
  hotspots?: ScanHotspotSummary | OwnershipRankingEntry[] | { ranking: OwnershipRankingEntry[] };
  fixTargets?: FixTarget[];
  duplicateClusters?: DuplicateLogicCluster[];
  fileToRepositoryPath?: Map<string, string> | Record<string, string>;
  handoffLimit?: number;
  unownedLimit?: number;
  topFilesPerOwner?: number;
}

interface OwnershipRankingEntry {
  file: string;
  repositoryPath?: string;
  totalIssues?: number;
  distinctRules?: number;
  bySeverity?: Record<Severity, number>;
  score?: number;
  reasons?: string[];
  topRules?: Array<{ ruleId: string; count: number }>;
}

interface CodeownersMatch {
  owners: string[];
  pattern: string;
  line: number;
}

export function parseCodeowners(content: string, path?: string): { rules: CodeownersRule[]; warnings: string[] } {
  const rules: CodeownersRule[] = [];
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const parsedLine = parseCodeownersLine(trimmed);
    if (!parsedLine) continue;
    const { pattern, ownerTokens } = parsedLine;

    const unsupportedReason = getUnsupportedPatternReason(pattern);
    if (unsupportedReason) {
      warnings.push(formatWarning(path, lineNumber, `unsupported pattern "${pattern}" (${unsupportedReason}); rule skipped`));
      continue;
    }

    const invalidOwners = ownerTokens.filter((owner) => !isValidOwner(owner));
    if (invalidOwners.length > 0) {
      warnings.push(formatWarning(path, lineNumber, `invalid owner token "${invalidOwners[0]}" in rule "${pattern}"; rule skipped`));
      continue;
    }

    rules.push({
      pattern,
      owners: dedupe(ownerTokens),
      line: lineNumber,
    });
  }

  return { rules, warnings };
}

export function matchCodeowners(rules: CodeownersRule[], repositoryPath: string): CodeownersMatch | undefined {
  const normalizedPath = normalizeRepositoryPath(repositoryPath);
  if (normalizedPath.length === 0) return undefined;

  let match: CodeownersMatch | undefined;
  for (const rule of rules) {
    if (matchesCodeownersPattern(rule.pattern, normalizedPath)) {
      match = {
        owners: [...rule.owners],
        pattern: rule.pattern,
        line: rule.line,
      };
    }
  }
  return match;
}

export function loadCodeowners(cwd: string, explicitPath?: string): CodeownersFile | undefined {
  const cwdRoot = resolve(cwd);
  const root = resolveGitRoot(cwd) ?? cwdRoot;
  const candidates = explicitPath
    ? [isAbsolute(explicitPath) ? explicitPath : resolve(cwdRoot, explicitPath)]
    : [
        resolve(root, ".github", "CODEOWNERS"),
        resolve(root, "CODEOWNERS"),
        resolve(root, "docs", "CODEOWNERS"),
      ];
  const discoveryWarnings: string[] = [];

  for (const candidate of candidates) {
    let stats;
    try {
      stats = statSync(candidate);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    if (stats.size >= maxCodeownersSizeBytes) {
      discoveryWarnings.push(`${candidate}: skipped CODEOWNERS file >= 3 MiB`);
      return undefined;
    }

    const parsed = parseCodeowners(readFileSync(candidate, "utf8"), candidate);
    const warnings = uniqueStrings([...discoveryWarnings, ...parsed.warnings]);
    return {
      path: candidate,
      root,
      rules: parsed.rules,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  return undefined;
}

function resolveGitRoot(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function buildOwnershipSummary(input: BuildOwnershipSummaryInput): ScanOwnershipSummary | undefined {
  const codeownersPath = input.codeowners?.path ?? input.codeownersPath;
  if (!codeownersPath) return undefined;

  const rules = input.codeowners?.rules ?? input.rules ?? [];
  const root = input.codeowners?.root ?? input.root;
  const warnings = uniqueStrings([
    ...(input.codeowners?.warnings ?? []),
    ...(input.warnings ?? []),
  ]);
  const issuesByFile = groupIssuesByInputFile(input.issues);
  const rankingByFile = buildRankingByFile(input, issuesByFile.size);
  const files: OwnershipFileSummary[] = [];
  const ownedHandoffs: OwnershipHandoff[] = [];
  const unownedHandoffs: OwnershipHandoff[] = [];

  for (const [file, issues] of issuesByFile) {
    const repositoryPath = repositoryPathForFile(file, root, input.fileToRepositoryPath);
    const match = matchCodeowners(rules, repositoryPath);
    const owners = match?.owners ?? [];
    const summary = summarizeIssues(issues);
    const fileSummary: OwnershipFileSummary = {
      file,
      repositoryPath,
      owners,
      totalIssues: issues.length,
      bySeverity: summary.bySeverity,
      ...(match ? { matchedPattern: match.pattern, matchedLine: match.line } : {}),
    };
    files.push(fileSummary);

    const ranking = rankingByFile.get(file) ?? rankingByFile.get(repositoryPath);
    const handoff = buildHandoff(fileSummary, issues, ranking);
    if (owners.length > 0) ownedHandoffs.push(handoff);
    else unownedHandoffs.push(handoff);
  }

  const allOwnedHandoffs = ownedHandoffs.sort(compareHandoffs);
  const allUnownedHandoffs = unownedHandoffs.sort(compareHandoffs);
  const ownerSummaries = buildOwnerSummaries(allOwnedHandoffs, input.topFilesPerOwner ?? 5);

  return {
    source: "codeowners",
    codeownersPath,
    files: files.sort(compareFileSummaries),
    ownerSummaries,
    handoffs: limitEntries(allOwnedHandoffs, input.handoffLimit),
    unownedHotspots: limitEntries(allUnownedHandoffs, input.unownedLimit),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function getUnsupportedPatternReason(pattern: string): string | undefined {
  if (pattern.startsWith("!")) return "negation is not supported";
  if (pattern.startsWith("\\#")) return "escaped leading # is not supported";
  if (pattern.includes("[") || pattern.includes("]")) return "bracket ranges are not supported";
  return undefined;
}

function parseCodeownersLine(trimmed: string): { pattern: string; ownerTokens: string[] } | undefined {
  let pattern = "";
  let index = 0;
  while (index < trimmed.length) {
    const char = trimmed[index];
    if (/\s/.test(char ?? "")) break;
    if (char === "\\" && /\s/.test(trimmed[index + 1] ?? "")) {
      pattern += trimmed[index + 1];
      index += 2;
      continue;
    }
    pattern += char ?? "";
    index += 1;
  }
  if (pattern.length === 0) return undefined;

  const ownerTokens = trimmed.slice(index).trim().split(/\s+/).filter(Boolean);
  const commentIndex = ownerTokens.findIndex((token) => token.startsWith("#"));
  return {
    pattern,
    ownerTokens: commentIndex === -1 ? ownerTokens : ownerTokens.slice(0, commentIndex),
  };
}

function isValidOwner(owner: string): boolean {
  return /^@[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/.test(owner)
    || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(owner);
}

function formatWarning(path: string | undefined, line: number, message: string): string {
  return path ? `${path}:${line}: ${message}` : `line ${line}: ${message}`;
}

function matchesCodeownersPattern(rawPattern: string, repositoryPath: string): boolean {
  const normalizedPattern = rawPattern.replace(/\\/g, "/");
  const anchored = normalizedPattern.startsWith("/");
  let pattern = anchored ? normalizedPattern.replace(/^\/+/, "") : normalizedPattern;
  const directoryPattern = pattern.endsWith("/");
  if (directoryPattern) pattern = pattern.replace(/\/+$/, "");
  if (pattern.length === 0) return false;

  const rooted = anchored || pattern.includes("/");
  if (directoryPattern) {
    return matchesDirectoryPattern(pattern, repositoryPath, rooted);
  }

  if (!pattern.includes("/") && !pattern.includes("**")) {
    if (anchored) return matchesAnchoredSingleSegmentPattern(pattern, repositoryPath);
    return matchesBasenamePattern(pattern, repositoryPath);
  }

  const descendantMatch = isDirectoryishPathPattern(pattern);
  return new RegExp(`^${globToRegex(pattern)}${descendantMatch ? "(?:/.*)?" : ""}$`).test(repositoryPath);
}

function matchesAnchoredSingleSegmentPattern(pattern: string, repositoryPath: string): boolean {
  const segmentRegex = new RegExp(`^${globToRegex(pattern)}$`);
  const [firstSegment] = repositoryPath.split("/");
  return segmentRegex.test(firstSegment ?? "");
}

function matchesDirectoryPattern(pattern: string, repositoryPath: string, rooted: boolean): boolean {
  if (rooted || pattern.includes("**")) {
    return new RegExp(`^${globToRegex(pattern)}(?:/.*)?$`).test(repositoryPath);
  }

  const segmentRegex = new RegExp(`^${globToRegex(pattern)}$`);
  return repositoryPath.split("/").some((segment) => segmentRegex.test(segment));
}

function matchesBasenamePattern(pattern: string, repositoryPath: string): boolean {
  const segments = repositoryPath.split("/");
  const basename = segments[segments.length - 1] ?? "";
  const segmentRegex = new RegExp(`^${globToRegex(pattern)}$`);
  if (segmentRegex.test(basename)) return true;

  if (hasGlob(pattern)) {
    return segments.slice(0, -1).some((segment) => segmentRegex.test(segment));
  }

  if (!pattern.includes(".")) {
    return segments.slice(0, -1).some((segment) => segmentRegex.test(segment));
  }
  return false;
}

function isDirectoryishPathPattern(pattern: string): boolean {
  const finalSegment = pattern.slice(pattern.lastIndexOf("/") + 1);
  return finalSegment.length > 0 && !hasGlob(finalSegment);
}

function globToRegex(pattern: string): string {
  let regex = "";
  for (let index = 0; index < pattern.length;) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        if (pattern[index + 2] === "/") {
          regex += "(?:.*/)?";
          index += 3;
        } else {
          regex += ".*";
          index += 2;
        }
      } else {
        regex += "[^/]*";
        index += 1;
      }
    } else if (char === "?") {
      regex += "[^/]";
      index += 1;
    } else {
      regex += escapeRegex(char ?? "");
      index += 1;
    }
  }
  return regex;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function hasGlob(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

function normalizeRepositoryPath(path: string): string {
  let normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  while (normalized.startsWith("/")) normalized = normalized.slice(1);
  return normalized.replace(/\/$/, "");
}

function groupIssuesByInputFile(issues: DebtIssue[]): Map<string, DebtIssue[]> {
  const byFile = new Map<string, DebtIssue[]>();
  for (const issue of issues) {
    const group = byFile.get(issue.file);
    if (group) group.push(issue);
    else byFile.set(issue.file, [issue]);
  }
  return byFile;
}

function buildRankingByFile(input: BuildOwnershipSummaryInput, fileCount: number): Map<string, OwnershipRankingEntry> {
  const ranking = new Map<string, OwnershipRankingEntry>();
  for (const target of buildFixTargets(input.issues, {
    duplicateClusters: input.duplicateClusters,
    limit: fileCount,
  })) {
    addRankingEntry(ranking, target);
  }
  for (const target of hotspotRankingEntries(input.hotspots)) {
    addRankingEntry(ranking, target);
  }
  for (const target of input.fixTargets ?? []) {
    addRankingEntry(ranking, target);
  }
  return ranking;
}

function hotspotRankingEntries(hotspots: BuildOwnershipSummaryInput["hotspots"]): OwnershipRankingEntry[] {
  if (!hotspots) return [];
  if (Array.isArray(hotspots)) return hotspots;
  return hotspots.ranking;
}

function addRankingEntry(ranking: Map<string, OwnershipRankingEntry>, entry: OwnershipRankingEntry): void {
  ranking.set(entry.file, entry);
  if (entry.repositoryPath) ranking.set(entry.repositoryPath, entry);
}

function repositoryPathForFile(
  file: string,
  root: string | undefined,
  fileToRepositoryPath: BuildOwnershipSummaryInput["fileToRepositoryPath"],
): string {
  const mapped = getMappedRepositoryPath(fileToRepositoryPath, file);
  if (mapped) return normalizeRepositoryPath(mapped);
  if (root && isAbsolute(file)) return normalizeRepositoryPath(relative(root, file));
  return normalizeRepositoryPath(file);
}

function getMappedRepositoryPath(
  fileToRepositoryPath: BuildOwnershipSummaryInput["fileToRepositoryPath"],
  file: string,
): string | undefined {
  if (!fileToRepositoryPath) return undefined;
  if (fileToRepositoryPath instanceof Map) return fileToRepositoryPath.get(file);
  return fileToRepositoryPath[file];
}

function buildHandoff(
  fileSummary: OwnershipFileSummary,
  issues: DebtIssue[],
  ranking: OwnershipRankingEntry | undefined,
): OwnershipHandoff {
  const distinctRules = ranking?.distinctRules ?? new Set(issues.map((issue) => issue.ruleId)).size;
  const topRules = ranking?.topRules?.length ? ranking.topRules : buildTopRules(issues);
  const score = ranking?.score ?? calculateScore(issues, distinctRules);
  const reasons = ranking?.reasons?.length ? ranking.reasons : buildReasons(fileSummary.bySeverity, distinctRules);

  return {
    file: fileSummary.file,
    repositoryPath: fileSummary.repositoryPath,
    owners: fileSummary.owners,
    totalIssues: fileSummary.totalIssues,
    distinctRules,
    bySeverity: fileSummary.bySeverity,
    score,
    reasons,
    topRules,
    ...(fileSummary.matchedPattern ? { matchedPattern: fileSummary.matchedPattern, matchedLine: fileSummary.matchedLine } : {}),
  };
}

function buildTopRules(issues: DebtIssue[]): Array<{ ruleId: string; count: number }> {
  return groupIssuesByRule(issues)
    .map(([ruleId, ruleIssues]) => ({ ruleId, count: ruleIssues.length }))
    .sort((left, right) => {
      const countDelta = right.count - left.count;
      if (countDelta !== 0) return countDelta;
      return left.ruleId.localeCompare(right.ruleId);
    })
    .slice(0, 3);
}

function calculateScore(issues: DebtIssue[], distinctRules: number): number {
  return issues.reduce((total, issue) => total + severityWeight[issue.severity], 0)
    + distinctRules * 4
    + issues.length;
}

function buildReasons(bySeverity: Record<Severity, number>, distinctRules: number): string[] {
  const reasons: string[] = [];
  if (bySeverity.high > 0) reasons.push(`${bySeverity.high} high-severity finding${plural(bySeverity.high)}`);
  if (bySeverity.medium > 0) reasons.push(`${bySeverity.medium} medium-severity finding${plural(bySeverity.medium)}`);
  if (reasons.length === 0 && bySeverity.low > 0) reasons.push(`${bySeverity.low} low-severity finding${plural(bySeverity.low)}`);
  if (reasons.length === 0 && bySeverity.info > 0) reasons.push(`${bySeverity.info} info finding${plural(bySeverity.info)}`);
  if (distinctRules > 1) reasons.push(`${distinctRules} distinct rules`);
  if (reasons.length === 0) reasons.push("highest remaining issue concentration");
  return reasons;
}

function buildOwnerSummaries(handoffs: OwnershipHandoff[], topFilesPerOwner: number): OwnershipOwnerSummary[] {
  const owners = new Map<string, OwnershipOwnerSummary>();

  for (const handoff of handoffs) {
    for (const owner of handoff.owners) {
      const summary = owners.get(owner) ?? {
        owner,
        files: 0,
        totalIssues: 0,
        bySeverity: zeroSeverityCounts(),
        topFiles: [],
      };
      summary.files += 1;
      summary.totalIssues += handoff.totalIssues;
      for (const severity of severityOrder()) {
        summary.bySeverity[severity] += handoff.bySeverity[severity];
      }
      summary.topFiles.push({
        file: handoff.file,
        totalIssues: handoff.totalIssues,
        score: handoff.score,
      });
      owners.set(owner, summary);
    }
  }

  return [...owners.values()]
    .map((summary) => ({
      ...summary,
      topFiles: summary.topFiles.sort(compareTopFiles).slice(0, Math.max(0, topFilesPerOwner)),
    }))
    .sort(compareOwnerSummaries);
}

function compareFileSummaries(left: OwnershipFileSummary, right: OwnershipFileSummary): number {
  const byRepositoryPath = left.repositoryPath.localeCompare(right.repositoryPath);
  if (byRepositoryPath !== 0) return byRepositoryPath;
  return left.file.localeCompare(right.file);
}

function compareHandoffs(left: OwnershipHandoff, right: OwnershipHandoff): number {
  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) return scoreDelta;
  for (const severity of severityOrder()) {
    const severityDelta = right.bySeverity[severity] - left.bySeverity[severity];
    if (severityDelta !== 0) return severityDelta;
  }
  const ruleDelta = right.distinctRules - left.distinctRules;
  if (ruleDelta !== 0) return ruleDelta;
  const issueDelta = right.totalIssues - left.totalIssues;
  if (issueDelta !== 0) return issueDelta;
  const byFile = left.file.localeCompare(right.file);
  if (byFile !== 0) return byFile;
  return left.repositoryPath.localeCompare(right.repositoryPath);
}

function compareOwnerSummaries(left: OwnershipOwnerSummary, right: OwnershipOwnerSummary): number {
  const issueDelta = right.totalIssues - left.totalIssues;
  if (issueDelta !== 0) return issueDelta;
  for (const severity of severityOrder()) {
    const severityDelta = right.bySeverity[severity] - left.bySeverity[severity];
    if (severityDelta !== 0) return severityDelta;
  }
  const fileDelta = right.files - left.files;
  if (fileDelta !== 0) return fileDelta;
  return left.owner.localeCompare(right.owner);
}

function compareTopFiles(left: { file: string; totalIssues: number; score: number }, right: { file: string; totalIssues: number; score: number }): number {
  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) return scoreDelta;
  const issueDelta = right.totalIssues - left.totalIssues;
  if (issueDelta !== 0) return issueDelta;
  return left.file.localeCompare(right.file);
}

function limitEntries<T>(entries: T[], limit: number | undefined): T[] {
  if (limit === undefined) return entries;
  return entries.slice(0, Math.max(0, limit));
}

function zeroSeverityCounts(): Record<Severity, number> {
  return { info: 0, low: 0, medium: 0, high: 0 };
}

function severityOrder(): Severity[] {
  return ["high", "medium", "low", "info"];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
