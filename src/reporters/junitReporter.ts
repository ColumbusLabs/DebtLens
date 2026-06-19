import type { DebtIssue, ScanResult, SuppressionDirectiveAudit } from "../core/types.js";

export function renderJunit(result: ScanResult): string {
  const cases = result.issues.map((issue) => renderTestCase(issue)).join("\n");
  const suppressionCases = (result.suppressionDirectives ?? []).map(renderSuppressionTestCase).join("\n");
  const suppressionCount = result.suppressionDirectives?.length ?? 0;
  const totalTests = result.issues.length + suppressionCount;
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="DebtLens" tests="${totalTests}" failures="${result.issues.length}" skipped="${suppressionCount}">
  <testsuite name="DebtLens findings" tests="${result.issues.length}" failures="${result.issues.length}">
${cases}
  </testsuite>
${suppressionCount > 0 ? `  <testsuite name="DebtLens suppression audit" tests="${suppressionCount}" failures="0" skipped="${suppressionCount}">
${suppressionCases}
  </testsuite>
` : ""}
</testsuites>
`;
}

function renderTestCase(issue: DebtIssue): string {
  const line = issue.location?.startLine;
  const classname = issue.file.replaceAll("/", ".");
  const location = line ? `${issue.file}:${line}` : issue.file;
  return `    <testcase classname="${escapeXmlAttribute(classname)}" name="${escapeXmlAttribute(`${issue.ruleId} ${location}`)}" file="${escapeXmlAttribute(issue.file)}"${line ? ` line="${line}"` : ""}>
      <failure type="${escapeXmlAttribute(issue.severity)}" message="${escapeXmlAttribute(`[${issue.ruleId}] ${issue.message}`)}">${escapeXmlText(renderFailureBody(issue, location))}</failure>
    </testcase>`;
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
