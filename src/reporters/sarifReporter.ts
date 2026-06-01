import type { ScanResult, Severity } from "../core/types.js";
import { allDetectors } from "../detectors/index.js";

const TOOL_VERSION = "0.1.1";
const INFORMATION_URI = "https://github.com/ColumbusLabs/debtlens";

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

/**
 * Render a scan result as SARIF 2.1.0 for GitHub code scanning and other tools.
 * The full rule catalog (all detectors) is always emitted under `tool.driver.rules`
 * so rule indices stay stable regardless of which rules produced results.
 */
export function renderSarif(result: ScanResult): string {
  const ruleIndex = new Map<string, number>();
  const rules = allDetectors.map((detector, index) => {
    ruleIndex.set(detector.id, index);
    return {
      id: detector.id,
      name: detector.name,
      shortDescription: { text: detector.description },
      defaultConfiguration: { level: toSarifLevel(detector.defaultSeverity) },
      properties: { tags: detector.tags },
    };
  });

  const results = result.issues.map((issue) => ({
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
    properties: {
      confidence: issue.confidence,
      severity: issue.severity,
      ...(issue.evidence?.length ? { evidence: issue.evidence } : {}),
      ...(issue.suggestion ? { suggestion: issue.suggestion } : {}),
    },
  }));

  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "DebtLens",
            informationUri: INFORMATION_URI,
            version: TOOL_VERSION,
            rules,
          },
        },
        results,
      },
    ],
  };

  return `${JSON.stringify(sarif, null, 2)}\n`;
}
