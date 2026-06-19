import type { DebtIssue, InlineSuppressionAudit, ScanResult, Severity, SuppressionDirectiveAudit } from "../core/types.js";
import { allDetectors } from "../detectors/index.js";
import { packageVersion } from "../utils/packageInfo.js";

const INFORMATION_URI = "https://github.com/ColumbusLabs/debtlens";
const RULE_DOCS_URI = "https://github.com/ColumbusLabs/DebtLens/blob/main/docs/rules.md";

type SarifLevel = "error" | "warning" | "note" | "none";

function toSarifLevel(severity: Severity): SarifLevel {
  switch (severity) {
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
    case "info":
      return "note";
    default:
      return "none";
  }
}

function ruleHelpUri(ruleId: string): string {
  return `${RULE_DOCS_URI}#${ruleId}`;
}

/**
 * Render a scan result as SARIF 2.1.0 for GitHub code scanning and other tools.
 * The full rule catalog is emitted by default so rule indices stay stable. Compact
 * mode emits only rules referenced by findings or suppression audit entries.
 */
export function renderSarif(result: ScanResult, options: { compact?: boolean } = {}): string {
  const ruleIndex = new Map<string, number>();
  const usedRuleIds = new Set([
    ...result.issues.map((issue) => issue.ruleId),
    ...(result.suppressions ?? []).map((suppression) => suppression.ruleId),
    ...(result.suppressionDirectives ?? []).map((directive) => directive.ruleId),
  ]);
  const catalog = options.compact
    ? allDetectors.filter((detector) => usedRuleIds.has(detector.id))
    : allDetectors;
  const knownRuleIds = new Set(catalog.map((detector) => detector.id));
  const rules = [
    ...catalog.map((detector, index) => {
      ruleIndex.set(detector.id, index);
      return {
        id: detector.id,
        name: detector.name,
        shortDescription: { text: detector.description },
        helpUri: ruleHelpUri(detector.id),
        defaultConfiguration: { level: toSarifLevel(detector.defaultSeverity) },
        properties: { tags: detector.tags },
      };
    }),
    ...[...usedRuleIds].filter((ruleId) => !knownRuleIds.has(ruleId)).sort().map((ruleId) => {
      const index = ruleIndex.size;
      ruleIndex.set(ruleId, index);
      return {
        id: ruleId,
        name: ruleId,
        shortDescription: { text: "Plugin-provided DebtLens rule" },
        helpUri: ruleHelpUri(ruleId),
        defaultConfiguration: { level: "warning" as SarifLevel },
        properties: { tags: ["plugin"] },
      };
    }),
  ];

  const results = [
    ...result.issues.map((issue) => toSarifResult(issue, ruleIndex)),
    ...(result.suppressions ?? []).map((suppression) => toSarifResult(suppression.issue, ruleIndex, suppression)),
  ];
  const toolExecutionNotifications = (result.suppressionDirectives ?? []).map(toSarifSuppressionNotification);

  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "DebtLens",
            informationUri: INFORMATION_URI,
            version: packageVersion,
            rules,
          },
        },
        results,
        ...(toolExecutionNotifications.length
          ? { invocations: [{ executionSuccessful: true, toolExecutionNotifications }] }
          : {}),
      },
    ],
  };

  return `${JSON.stringify(sarif, null, 2)}\n`;
}

function toSarifSuppressionNotification(directive: SuppressionDirectiveAudit) {
  return {
    level: directive.status === "unused" || directive.kind === "file" ? "warning" : "note",
    message: {
      text: [
        `Suppression directive ${directive.status}: ${directive.ruleId}`,
        `kind=${directive.kind}`,
        `reason=${directive.reason}`,
        `hidden findings=${directive.suppressedIssueCount}`,
        `action=${directive.recommendedAction}`,
      ].join("; "),
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: directive.file },
          region: { startLine: directive.directiveLine },
        },
      },
    ],
    properties: {
      ruleId: directive.ruleId,
      kind: directive.kind,
      reason: directive.reason,
      status: directive.status,
      suppressedIssueCount: directive.suppressedIssueCount,
      recommendedAction: directive.recommendedAction,
      directiveLine: directive.directiveLine,
      ...(directive.targetLine ? { targetLine: directive.targetLine } : {}),
    },
  };
}

function toSarifResult(
  issue: DebtIssue,
  ruleIndex: Map<string, number>,
  suppression?: InlineSuppressionAudit,
) {
  return {
    ruleId: issue.ruleId,
    ruleIndex: ruleIndex.get(issue.ruleId) ?? -1,
    level: toSarifLevel(issue.severity),
    message: { text: issue.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: issue.file },
          region: {
            startLine: issue.location?.startLine ?? 1,
            ...(issue.location?.endLine ? { endLine: issue.location.endLine } : {}),
            ...(issue.location?.startColumn ? { startColumn: issue.location.startColumn } : {}),
          },
        },
      },
    ],
    ...(suppression
      ? {
          suppressions: [
            {
              kind: "inSource",
              status: "accepted",
              justification: suppression.reason,
              location: {
                physicalLocation: {
                  artifactLocation: { uri: suppression.file },
                  region: { startLine: suppression.directiveLine },
                },
              },
            },
          ],
        }
      : {}),
    properties: {
      confidence: issue.confidence,
      severity: issue.severity,
      fingerprint: issue.fingerprint ?? issue.id,
      ...(suppression ? { suppressedBy: suppression.kind, suppressionDirectiveLine: suppression.directiveLine } : {}),
      ...(issue.evidence?.length ? { evidence: issue.evidence } : {}),
      ...(issue.suggestion ? { suggestion: issue.suggestion } : {}),
    },
  };
}
