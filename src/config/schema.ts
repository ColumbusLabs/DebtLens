import { severities } from "../core/severity.js";
import { detectorIds } from "../detectors/index.js";
import { defaultConfig } from "./defaults.js";

export const SCHEMA_ID =
  "https://raw.githubusercontent.com/ColumbusLabs/debtlens/main/schema/debtlens.config.schema.json";

/**
 * Build the JSON Schema for `debtlens.config.json`. Generated from the live rule list,
 * severity set, and default threshold keys so it cannot drift from the code. A test
 * asserts the committed schema file matches this output.
 */
export function buildConfigSchema(): Record<string, unknown> {
  const knownThresholds = Object.fromEntries(
    Object.keys(defaultConfig.thresholds).map((key) => [key, { type: "number" }]),
  );

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: SCHEMA_ID,
    title: "DebtLens configuration",
    description: "Configuration for the DebtLens static-analysis CLI.",
    type: "object",
    additionalProperties: false,
    properties: {
      $schema: { type: "string" },
      include: {
        type: "array",
        items: { type: "string" },
        description: "Glob patterns to scan.",
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description: "Glob patterns to skip.",
      },
      minSeverity: {
        enum: [...severities],
        description: "Lowest severity to report.",
      },
      rules: {
        type: "array",
        uniqueItems: true,
        items: { enum: [...detectorIds] },
        description: "Rule ids to run. Omit to run all rules.",
      },
      maxFiles: {
        type: "integer",
        minimum: 1,
        description: "Maximum number of files to scan.",
      },
      thresholds: {
        type: "object",
        description: "Per-rule numeric threshold overrides.",
        properties: knownThresholds,
        additionalProperties: { type: "number" },
      },
      vocabulary: {
        type: "object",
        description: "Naming-drift concept groups (concept id -> competing terms).",
        additionalProperties: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  };
}
