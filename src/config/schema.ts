import { severities } from "../core/severity.js";
import { gatePresets } from "../core/gatePresets.js";
import { detectorIds } from "../detectors/index.js";
import { listRulePacks, RULE_PACK_IDS } from "./packs.js";
import { defaultConfig } from "./defaults.js";

export const SCHEMA_ID =
  "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json";

/**
 * Build the JSON Schema for `debtlens.config.json`. Generated from the live rule list,
 * severity set, and default threshold keys so it cannot drift from the code. A test
 * asserts the committed schema file matches this output.
 */
export function buildConfigSchema(): Record<string, unknown> {
  const knownThresholds = Object.fromEntries(
    Object.keys({
      ...defaultConfig.thresholds,
      ...Object.assign({}, ...listRulePacks().map((pack) => pack.thresholds ?? {})),
    }).map((key) => [key, { type: "number" }]),
  );
  const packAlternation = RULE_PACK_IDS.map(escapeRegex).join("|");
  const severityValue = { enum: [...severities] };
  const confidenceFloorValue = { type: "number", minimum: 0, maximum: 1 };
  const knownRuleSeverities = Object.fromEntries(detectorIds.map((id) => [id, severityValue]));
  const knownRuleConfidenceFloors = Object.fromEntries(detectorIds.map((id) => [id, confidenceFloorValue]));

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
      pack: {
        anyOf: [
          { enum: [...RULE_PACK_IDS] },
          { type: "string", pattern: `^\\s*(?:${packAlternation})(?:\\s*,\\s*(?:${packAlternation}))*\\s*$` },
        ],
        description: "Built-in rule pack preset, or a comma-separated list of presets. Explicit rules override the pack.",
      },
      rules: {
        type: "array",
        uniqueItems: true,
        items: {
          anyOf: [
            { enum: [...detectorIds] },
            { type: "string", description: "A plugin-provided rule id." },
          ],
        },
        description: "Rule ids to run. Omit to run all rules. May include plugin rule ids when plugins are configured.",
      },
      pluginApiVersion: {
        type: "integer",
        minimum: 1,
        description: "Plugin API version this config targets; must match the DebtLens runtime version.",
      },
      plugins: {
        type: "array",
        items: { type: "string" },
        description: "Paths to local ESM plugin modules, resolved relative to the config file directory.",
      },
      maxFiles: {
        type: "integer",
        minimum: 1,
        description: "Maximum number of files to scan.",
      },
      respectGitignore: {
        type: "boolean",
        description: "When true, skip files ignored by git in addition to configured exclude globs.",
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
      ruleSeverities: {
        type: "object",
        description: "Rule id -> severity reported for that rule's issues, replacing the detector's choice. May include plugin rule ids.",
        properties: knownRuleSeverities,
        additionalProperties: severityValue,
      },
      ruleConfidenceFloors: {
        type: "object",
        description: "Rule id -> minimum confidence (0-1); issues from that rule below the floor are not reported. May include plugin rule ids.",
        properties: knownRuleConfidenceFloors,
        additionalProperties: confidenceFloorValue,
      },
      propDrilling: {
        type: "object",
        description: "Prop-drilling rule configuration.",
        properties: {
          ignoreComponents: {
            type: "array",
            items: { type: "string" },
            description: "Additional UI primitive component names to ignore (extends built-in host components).",
          },
        },
        additionalProperties: false,
      },
      duplicatedLiteral: {
        type: "object",
        description: "Duplicated-literal rule configuration.",
        properties: {
          ignoreStrings: {
            type: "array",
            items: { type: "string" },
            description: "Exact string literal values to ignore, such as framework directives.",
          },
        },
        additionalProperties: false,
      },
      todoComment: {
        type: "object",
        description: "Todo-comment rule configuration.",
        properties: {
          markers: {
            type: "array",
            description: "Additional or replacement comment marker patterns.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                pattern: { type: "string", description: "Case-insensitive regex pattern." },
                severity: { enum: [...severities], description: "Severity when this marker matches." },
                label: { type: "string", description: "Human-readable marker label for reports." },
              },
              required: ["pattern"],
            },
          },
          replaceDefaults: {
            type: "boolean",
            description: "When true, built-in marker patterns are not used.",
          },
          disableDefaults: {
            type: "array",
            items: { type: "string" },
            description: "Built-in marker labels to disable (e.g. \"todo marker\").",
          },
        },
        additionalProperties: false,
      },
      namingDrift: {
        type: "object",
        description: "Naming-drift rule configuration.",
        properties: {
          disableBuiltInVocabulary: {
            type: "boolean",
            description: "When true, skip built-in concept groups; only user vocabulary applies.",
          },
        },
        additionalProperties: false,
      },
      failOn: {
        enum: [...severities],
        description: "Exit with code 1 when any reported issue meets this severity. The --fail-on CLI flag overrides this.",
      },
      failOnConfidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "With fail-on severity policy, require at least this confidence to exit with code 1.",
      },
      gatePreset: {
        enum: [...gatePresets],
        description: "Named quality-gate rollout preset. Explicit CLI flags override preset defaults.",
      },
    },
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
