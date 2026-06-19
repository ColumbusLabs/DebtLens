import { severityRank } from "../core/severity.js";
import type { DebtIssue, ScanResult, Severity, SuppressionDirectiveAudit } from "../core/types.js";

export function renderJunit(result: ScanResult, options: { failOn?: Severity } = {}): string {
  const failingIssues = result.issues.filter((issue) => shouldFailIssue(issue, options.failOn));
  const skippedIssues = result.issues.length - failingIssues.length;
  const cases = result.issues.map((issue) => renderTestCase(issue, options.failOn)).join("\n");
  const suppressionCases = (result.suppressionDirectives ?? []).map(renderSuppressionTestCase).join("\n");
  const suppressionCount = result.suppressionDirectives?.length ?? 0;
  const totalTests = result.issues.length + suppressionCount;
  const skippedCount = skippedIssues + suppressionCount;
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="DebtLens" tests="${totalTests}" failures="${failingIssues.length}" skipped="${skippedCount}">
  <testsuite name="DebtLens findings" tests="${result.issues.length}" failures="${failingIssues.length}" skipped="${skippedIssues}">
${cases}
  </testsuite>
${suppressionCount > 0 ? `  <testsuite name="DebtLens suppression audit" tests="${suppressionCount}" failures="0" skipped="${suppressionCount}">
${suppressionCases}
  </testsuite>
` : ""}
</testsuites>
`;
}

function renderTestCase(issue: DebtIssue, failOn: Severity | undefined): string {
  const line = issue.location?.startLine;
  const classname = issue.file.replaceAll("/", ".");
  const location = line ? `${issue.file}:${line}` : issue.file;
  const body = renderFailureBody(issue, location);
  if (!shouldFailIssue(issue, failOn)) {
    return `    <testcase classname="${escapeXmlAttribute(classname)}" name="${escapeXmlAttribute(`${issue.ruleId} ${location}`)}" file="${escapeXmlAttribute(issue.file)}"${line ? ` line="${line}"` : ""}>
      <skipped message="${escapeXmlAttribute(`[${issue.ruleId}] ${issue.message}`)}">${escapeXmlText(body)}</skipped>
    </testcase>`;
  }
  return `    <testcase classname="${escapeXmlAttribute(classname)}" name="${escapeXmlAttribute(`${issue.ruleId} ${location}`)}" file="${escapeXmlAttribute(issue.file)}"${line ? ` line="${line}"` : ""}>
      <failure type="${escapeXmlAttribute(issue.severity)}" message="${escapeXmlAttribute(`[${issue.ruleId}] ${issue.message}`)}">${escapeXmlText(body)}</failure>
    </testcase>`;
}

function shouldFailIssue(issue: DebtIssue, failOn: Severity | undefined): boolean {
  if (!failOn) return true;
  return severityRank[issue.severity] >= severityRank[failOn];
}

function renderFailureBody(issue: DebtIssue, location: string): string {
  const lines = [
    `${issue.ruleName} (${issue.ruleId})`,
    `Location: ${location}`,
    `Severity: ${issue.severity}`,
    `Confidence: ${Math.round(issue.confidence * 100)}%`,
    issue.message,
  ];
  if (issue.suggestion) lines.push(`Suggestion: ${issue.suggestion}`);
  if (issue.evidence?.length) lines.push(`Evidence: ${issue.evidence.join("; ")}`);
  return lines.join("\n");
}

function renderSuppressionTestCase(directive: SuppressionDirectiveAudit): string {
  const classname = `debtlens.suppression.${directive.kind}`;
  const location = `${directive.file}:${directive.directiveLine}`;
  return `    <testcase classname="${escapeXmlAttribute(classname)}" name="${escapeXmlAttribute(`${directive.status} ${directive.ruleId} ${location}`)}" file="${escapeXmlAttribute(directive.file)}" line="${directive.directiveLine}">
      <skipped message="${escapeXmlAttribute(`[${directive.ruleId}] ${directive.recommendedAction}`)}">${escapeXmlText(renderSuppressionBody(directive, location))}</skipped>
    </testcase>`;
}

function renderSuppressionBody(directive: SuppressionDirectiveAudit, location: string): string {
  return [
    `Suppression directive (${directive.ruleId})`,
    `Location: ${location}`,
    `Kind: ${directive.kind}`,
    `Status: ${directive.status}`,
    `Reason: ${directive.reason}`,
    `Hidden findings: ${directive.suppressedIssueCount}`,
    `Recommended action: ${directive.recommendedAction}`,
  ].join("\n");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll("\"", "&quot;").replaceAll("'", "&apos;");
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
