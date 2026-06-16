import type { DebtIssue, ScanResult } from "../core/types.js";

export function renderJunit(result: ScanResult): string {
  const cases = result.issues.map((issue) => renderTestCase(issue)).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="DebtLens" tests="${result.issues.length}" failures="${result.issues.length}">
  <testsuite name="DebtLens findings" tests="${result.issues.length}" failures="${result.issues.length}">
${cases}
  </testsuite>
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

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll("\"", "&quot;").replaceAll("'", "&apos;");
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
