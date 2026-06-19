import { severities } from "./severity.js";

export const SCAN_RESULT_SCHEMA_ID =
  "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.scan-result.schema.json";

const severityValue = { enum: [...severities] };

export function buildScanResultSchema(): Record<string, unknown> {
  const issue = {
    type: "object",
    additionalProperties: false,
    required: ["id", "fingerprint", "ruleId", "ruleName", "severity", "confidence", "message", "file", "tags"],
    properties: {
      id: { type: "string", description: "Line-stable finding identifier. Equal to fingerprint in ScanResult schema v1." },
      fingerprint: { type: "string", description: "Line-stable finding fingerprint used for baselines and integrations." },
      ruleId: { type: "string" },
      ruleName: { type: "string" },
      severity: severityValue,
      confidence: { type: "number", minimum: 0, maximum: 1 },
      message: { type: "string" },
      file: { type: "string" },
      introducedDaysAgo: { type: "integer", minimum: 0 },
      location: {
        type: "object",
        additionalProperties: false,
        required: ["startLine"],
        properties: {
          startLine: { type: "integer", minimum: 1 },
          startColumn: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 },
          endColumn: { type: "integer", minimum: 1 },
        },
      },
      evidence: { type: "array", items: { type: "string" } },
      suggestion: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
  };

  const countSummary = {
    type: "object",
    additionalProperties: false,
    required: ["totalIssues", "bySeverity", "byRule"],
    properties: {
      totalIssues: { type: "integer", minimum: 0 },
      bySeverity: severityCountObject(),
      byRule: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
    },
  };
  const correlation = {
    type: "object",
    additionalProperties: false,
    required: ["file", "totalIssues", "rules"],
    properties: {
      file: { type: "string" },
      totalIssues: { type: "integer", minimum: 0 },
      rules: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ruleId", "ruleName", "count"],
          properties: {
            ruleId: { type: "string" },
            ruleName: { type: "string" },
            count: { type: "integer", minimum: 1 },
          },
        },
      },
    },
  };
  const duplicateCluster = {
    type: "object",
    additionalProperties: false,
    required: ["clusterId", "issueCount", "locations"],
    properties: {
      clusterId: { type: "string" },
      issueCount: { type: "integer", minimum: 1 },
      locations: {
        type: "array",
        minItems: 2,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["file", "startLine"],
          properties: {
            file: { type: "string" },
            startLine: { type: "integer", minimum: 1 },
            endLine: { type: "integer", minimum: 1 },
          },
        },
      },
    },
  };
  const fileChurnMetric = {
    type: "object",
    additionalProperties: false,
    required: ["file", "repositoryPath", "commits", "additions", "deletions", "changedLines"],
    properties: {
      file: { type: "string" },
      repositoryPath: { type: "string" },
      commits: { type: "integer", minimum: 0 },
      additions: { type: "integer", minimum: 0 },
      deletions: { type: "integer", minimum: 0 },
      changedLines: { type: "integer", minimum: 0 },
    },
  };
  const hotspot = {
    type: "object",
    additionalProperties: false,
    required: ["file", "repositoryPath", "totalIssues", "distinctRules", "bySeverity", "score", "churn", "reasons", "topRules"],
    properties: {
      file: { type: "string" },
      repositoryPath: { type: "string" },
      totalIssues: { type: "integer", minimum: 1 },
      distinctRules: { type: "integer", minimum: 1 },
      bySeverity: severityCountObject(),
      score: { type: "number", minimum: 0 },
      churn: fileChurnMetric,
      reasons: { type: "array", items: { type: "string" } },
      topRules: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ruleId", "count"],
          properties: {
            ruleId: { type: "string" },
            count: { type: "integer", minimum: 1 },
          },
        },
      },
    },
  };
  const ownershipFileSummary = {
    type: "object",
    additionalProperties: false,
    required: ["file", "repositoryPath", "owners", "totalIssues", "bySeverity"],
    properties: {
      file: { type: "string" },
      repositoryPath: { type: "string" },
      owners: { type: "array", items: { type: "string" } },
      totalIssues: { type: "integer", minimum: 1 },
      bySeverity: severityCountObject(),
      matchedPattern: { type: "string" },
      matchedLine: { type: "integer", minimum: 1 },
    },
  };
  const ownershipHandoff = {
    type: "object",
    additionalProperties: false,
    required: ["file", "repositoryPath", "owners", "totalIssues", "distinctRules", "bySeverity", "score", "reasons", "topRules"],
    properties: {
      file: { type: "string" },
      repositoryPath: { type: "string" },
      owners: { type: "array", items: { type: "string" } },
      totalIssues: { type: "integer", minimum: 1 },
      distinctRules: { type: "integer", minimum: 1 },
      bySeverity: severityCountObject(),
      score: { type: "number", minimum: 0 },
      reasons: { type: "array", items: { type: "string" } },
      topRules: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ruleId", "count"],
          properties: {
            ruleId: { type: "string" },
            count: { type: "integer", minimum: 1 },
          },
        },
      },
      matchedPattern: { type: "string" },
      matchedLine: { type: "integer", minimum: 1 },
    },
  };
  const ownershipOwnerSummary = {
    type: "object",
    additionalProperties: false,
    required: ["owner", "files", "totalIssues", "bySeverity", "topFiles"],
    properties: {
      owner: { type: "string" },
      files: { type: "integer", minimum: 1 },
      totalIssues: { type: "integer", minimum: 1 },
      bySeverity: severityCountObject(),
      topFiles: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["file", "totalIssues", "score"],
          properties: {
            file: { type: "string" },
            totalIssues: { type: "integer", minimum: 1 },
            score: { type: "number", minimum: 0 },
          },
        },
      },
    },
  };

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: SCAN_RESULT_SCHEMA_ID,
    title: "DebtLens ScanResult",
    description: "Versioned JSON report contract emitted by `debtlens scan --format json`.",
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "issues", "summary", "options"],
    properties: {
      schemaVersion: { const: 1 },
      issues: { type: "array", items: issue },
      suppressions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ruleId", "file", "kind", "reason", "directiveLine", "issue"],
          properties: {
            ruleId: { type: "string" },
            file: { type: "string" },
            kind: { enum: ["next-line", "file"] },
            reason: { type: "string", minLength: 1 },
            directiveLine: { type: "integer", minimum: 1 },
            targetLine: { type: "integer", minimum: 1 },
            issue,
          },
        },
      },
      suppressionDirectives: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "ruleId",
            "file",
            "kind",
            "reason",
            "directiveLine",
            "status",
            "suppressedIssueCount",
            "recommendedAction",
          ],
          properties: {
            ruleId: { type: "string" },
            file: { type: "string" },
            kind: { enum: ["next-line", "file"] },
            reason: { type: "string", minLength: 1 },
            directiveLine: { type: "integer", minimum: 1 },
            targetLine: { type: "integer", minimum: 1 },
            status: { enum: ["used", "unused", "not-evaluated"] },
            suppressedIssueCount: { type: "integer", minimum: 0 },
            recommendedAction: { type: "string", minLength: 1 },
          },
        },
      },
      summary: {
        type: "object",
        additionalProperties: false,
        required: ["totalIssues", "bySeverity", "byRule", "filesScanned", "rulesRun", "elapsedMs"],
        properties: {
          totalIssues: { type: "integer", minimum: 0 },
          bySeverity: severityCountObject(),
          byRule: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
          filesScanned: { type: "integer", minimum: 0 },
          rulesRun: { type: "integer", minimum: 0 },
          elapsedMs: { type: "integer", minimum: 0 },
          warnings: { type: "array", items: { type: "string" } },
          filterStats: {
            type: "object",
            additionalProperties: false,
            properties: {
              filteredByMinSeverity: { type: "integer", minimum: 0 },
              filteredByConfidenceFloor: { type: "integer", minimum: 0 },
              suppressedByBaseline: { type: "integer", minimum: 0 },
              suppressedByInline: { type: "integer", minimum: 0 },
            },
          },
          deltaFromBaseline: {
            type: "object",
            additionalProperties: false,
            required: ["new", "resolved", "changed", "severityRegressions", "totalDelta", "baseline", "current", "hasBaselineSummary", "byRule"],
            properties: {
              new: { type: "integer", minimum: 0 },
              resolved: { type: "integer", minimum: 0 },
              changed: { type: "integer", minimum: 0 },
              severityRegressions: { type: "integer", minimum: 0 },
              totalDelta: { type: "integer" },
              baseline: countSummary,
              current: countSummary,
              hasBaselineSummary: { type: "boolean" },
              byRule: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  additionalProperties: false,
                  required: ["baseline", "current", "delta"],
                  properties: {
                    baseline: { type: "integer", minimum: 0 },
                    current: { type: "integer", minimum: 0 },
                    delta: { type: "integer" },
                  },
                },
              },
            },
          },
          correlations: { type: "array", items: correlation },
          duplicateClusters: { type: "array", items: duplicateCluster },
          hotspots: {
            type: "object",
            additionalProperties: false,
            required: ["source", "window", "ranking"],
            properties: {
              source: { const: "git" },
              window: {
                type: "object",
                additionalProperties: false,
                properties: {
                  days: { type: "integer", minimum: 0 },
                  since: { type: "string" },
                  range: { type: "string" },
                },
              },
              ranking: { type: "array", items: hotspot },
            },
          },
          ownership: {
            type: "object",
            additionalProperties: false,
            required: ["source", "codeownersPath", "files", "ownerSummaries", "handoffs", "unownedHotspots"],
            properties: {
              source: { const: "codeowners" },
              codeownersPath: { type: "string" },
              files: { type: "array", items: ownershipFileSummary },
              ownerSummaries: { type: "array", items: ownershipOwnerSummary },
              handoffs: { type: "array", items: ownershipHandoff },
              unownedHotspots: { type: "array", items: ownershipHandoff },
              warnings: { type: "array", items: { type: "string" } },
            },
          },
          profile: {
            type: "object",
            additionalProperties: false,
            required: ["ruleTimingsMs"],
            properties: {
              ruleTimingsMs: { type: "object", additionalProperties: { type: "number", minimum: 0 } },
            },
          },
          performance: {
            type: "object",
            additionalProperties: false,
            properties: {
              cache: {
                type: "object",
                additionalProperties: false,
                required: ["enabled", "hit", "path"],
                properties: {
                  enabled: { type: "boolean" },
                  hit: { type: "boolean" },
                  path: { type: "string" },
                },
              },
              batchSize: { type: "integer", minimum: 1 },
              parallel: { type: "boolean" },
            },
          },
        },
      },
      options: {
        type: "object",
        additionalProperties: false,
        required: ["target", "include", "exclude", "minSeverity"],
        properties: {
          target: { type: "string" },
          include: { type: "array", items: { type: "string" } },
          exclude: { type: "array", items: { type: "string" } },
          minSeverity: severityValue,
          rules: { type: "array", items: { type: "string" } },
        },
      },
    },
  };
}

function severityCountObject(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [...severities],
    properties: Object.fromEntries(severities.map((severity) => [severity, { type: "integer", minimum: 0 }])),
  };
}
