import { isSeverity, severities } from "../core/severity.js";
import { gatePresets } from "../core/gatePresets.js";
import { RULE_PACK_IDS } from "./packs.js";
import type { DebtLensConfig } from "../core/types.js";
import { DEBTLENS_PLUGIN_API_VERSION } from "../plugins/version.js";

const knownRootKeys = new Set([
  "$schema",
  "include",
  "exclude",
  "minSeverity",
  "pack",
  "rules",
  "pluginApiVersion",
  "plugins",
  "maxFiles",
  "respectGitignore",
  "thresholds",
  "vocabulary",
  "ruleSeverities",
  "ruleConfidenceFloors",
  "propDrilling",
  "duplicatedLiteral",
  "todoComment",
  "namingDrift",
  "failOn",
  "failOnConfidence",
  "gatePreset",
  "budgets",
  "badge",
  "priority",
]);

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateConfigShape(config: unknown): ConfigValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(config)) {
    return { valid: false, errors: ["config must be a JSON object"] };
  }

  for (const key of Object.keys(config)) {
    if (!knownRootKeys.has(key)) {
      errors.push(`unknown property "${key}"`);
    }
  }

  const typed = config as DebtLensConfig;
  const raw = config as Record<string, unknown>;
  if (raw.$schema !== undefined && typeof raw.$schema !== "string") {
    errors.push("$schema must be a string");
  }
  validateStringArray(errors, "include", typed.include);
  validateStringArray(errors, "exclude", typed.exclude);
  validateStringArray(errors, "rules", typed.rules);
  validateStringArray(errors, "plugins", typed.plugins);
  validateUniqueStrings(errors, "rules", typed.rules);

  if (typed.minSeverity !== undefined && !isSeverity(String(typed.minSeverity))) {
    errors.push(`minSeverity must be one of ${severities.join(", ")}`);
  }
  if (typed.failOn !== undefined && !isSeverity(String(typed.failOn))) {
    errors.push(`failOn must be one of ${severities.join(", ")}`);
  }
  if (typed.gatePreset !== undefined && !gatePresets.includes(String(typed.gatePreset) as typeof gatePresets[number])) {
    errors.push(`Invalid gate preset "${String(typed.gatePreset)}"; gatePreset must be one of ${gatePresets.join(", ")}`);
  }
  if (typed.pack !== undefined) {
    if (typeof raw.pack !== "string") {
      errors.push(`pack must be one or more of ${RULE_PACK_IDS.join(", ")}`);
    } else {
      const unknownPackIds = parsePackIds(raw.pack).filter((packId) => !RULE_PACK_IDS.includes(packId));
      if (unknownPackIds.length) {
        errors.push(`pack must be one or more of ${RULE_PACK_IDS.join(", ")}`);
      }
    }
  }
  if (typed.maxFiles !== undefined && (!Number.isInteger(typed.maxFiles) || typed.maxFiles <= 0)) {
    errors.push("maxFiles must be a positive integer");
  }
  if (typed.respectGitignore !== undefined && typeof typed.respectGitignore !== "boolean") {
    errors.push("respectGitignore must be a boolean");
  }
  if (typed.pluginApiVersion !== undefined && (!Number.isInteger(typed.pluginApiVersion) || typed.pluginApiVersion < 1)) {
    errors.push("pluginApiVersion must be a positive integer");
  }
  if (typed.plugins?.length && typed.pluginApiVersion === undefined) {
    errors.push(`plugins requires pluginApiVersion; "plugins" requires "pluginApiVersion": ${DEBTLENS_PLUGIN_API_VERSION}`);
  }
  if (typed.failOnConfidence !== undefined && !isNumberInRange(typed.failOnConfidence, 0, 1)) {
    errors.push("failOnConfidence must be a number between 0 and 1");
  }

  validateNumberRecord(errors, "thresholds", typed.thresholds);
  validateStringArrayRecord(errors, "vocabulary", typed.vocabulary);
  validateSeverityRecord(errors, "ruleSeverities", typed.ruleSeverities);
  validateConfidenceRecord(errors, "ruleConfidenceFloors", typed.ruleConfidenceFloors);
  validatePropDrilling(errors, typed.propDrilling);
  validateDuplicatedLiteral(errors, typed.duplicatedLiteral);
  validateNamingDrift(errors, typed.namingDrift);
  validateTodoComment(errors, typed.todoComment);
  validateBudgets(errors, typed.budgets);
  validateBadge(errors, typed.badge);
  validatePriority(errors, typed.priority);

  return { valid: errors.length === 0, errors };
}

function validateUniqueStrings(errors: string[], key: string, value: unknown): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return;
  if (new Set(value).size !== value.length) {
    errors.push(`${key} must not contain duplicate values`);
  }
}

function parsePackIds(pack: string): string[] {
  return [...new Set(pack.split(",").map((packId) => packId.trim()).filter(Boolean))];
}

function validateStringArray(errors: string[], key: string, value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push(`${key} must be an array of strings`);
  }
}

function validateNumberRecord(errors: string[], key: string, value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${key} must be an object`);
    return;
  }
  for (const [recordKey, recordValue] of Object.entries(value)) {
    if (typeof recordValue !== "number" || !Number.isFinite(recordValue)) {
      errors.push(`${key}.${recordKey} must be a number`);
    }
  }
}

function validateStringArrayRecord(errors: string[], key: string, value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${key} must be an object`);
    return;
  }
  for (const [recordKey, recordValue] of Object.entries(value)) {
    if (!Array.isArray(recordValue) || recordValue.some((item) => typeof item !== "string")) {
      errors.push(`${key}.${recordKey} must be an array of strings`);
    }
  }
}

function validateSeverityRecord(errors: string[], key: string, value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${key} must be an object`);
    return;
  }
  for (const [ruleId, severity] of Object.entries(value)) {
    if (!isSeverity(String(severity))) {
      errors.push(`${key}.${ruleId} must be one of ${severities.join(", ")}`);
    }
  }
}

function validateConfidenceRecord(errors: string[], key: string, value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(`${key} must be an object`);
    return;
  }
  for (const [ruleId, floor] of Object.entries(value)) {
    if (!isNumberInRange(floor, 0, 1)) {
      errors.push(`${key}.${ruleId} must be a number between 0 and 1`);
    }
  }
}

function validatePropDrilling(errors: string[], value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push("propDrilling must be an object");
    return;
  }
  validateAllowedKeys(errors, "propDrilling", value, ["ignoreComponents"]);
  validateStringArray(errors, "propDrilling.ignoreComponents", value.ignoreComponents);
}

function validateDuplicatedLiteral(errors: string[], value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push("duplicatedLiteral must be an object");
    return;
  }
  validateAllowedKeys(errors, "duplicatedLiteral", value, ["ignoreStrings"]);
  validateStringArray(errors, "duplicatedLiteral.ignoreStrings", value.ignoreStrings);
}

function validateNamingDrift(errors: string[], value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push("namingDrift must be an object");
    return;
  }
  validateAllowedKeys(errors, "namingDrift", value, ["disableBuiltInVocabulary"]);
  if (value.disableBuiltInVocabulary !== undefined && typeof value.disableBuiltInVocabulary !== "boolean") {
    errors.push("namingDrift.disableBuiltInVocabulary must be a boolean");
  }
}

function validateTodoComment(errors: string[], value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push("todoComment must be an object");
    return;
  }
  validateAllowedKeys(errors, "todoComment", value, ["markers", "replaceDefaults", "disableDefaults"]);
  if (value.replaceDefaults !== undefined && typeof value.replaceDefaults !== "boolean") {
    errors.push("todoComment.replaceDefaults must be a boolean");
  }
  validateStringArray(errors, "todoComment.disableDefaults", value.disableDefaults);
  if (value.markers !== undefined) {
    if (!Array.isArray(value.markers)) {
      errors.push("todoComment.markers must be an array");
    } else {
      value.markers.forEach((marker, index) => {
        if (!isPlainObject(marker)) {
          errors.push(`todoComment.markers[${index}] must be an object`);
          return;
        }
        validateAllowedKeys(errors, `todoComment.markers[${index}]`, marker, ["pattern", "severity", "label"]);
        if (typeof marker.pattern !== "string") {
          errors.push(`todoComment.markers[${index}].pattern must be a string`);
        }
        if (marker.severity !== undefined && !isSeverity(String(marker.severity))) {
          errors.push(`todoComment.markers[${index}].severity must be one of ${severities.join(", ")}`);
        }
        if (marker.label !== undefined && typeof marker.label !== "string") {
          errors.push(`todoComment.markers[${index}].label must be a string`);
        }
      });
    }
  }
}

function validateBudgets(errors: string[], value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push("budgets must be an object");
    return;
  }
  for (const [pattern, budget] of Object.entries(value)) {
    if (!isPlainObject(budget)) {
      errors.push(`budgets.${pattern} must be an object`);
      continue;
    }
    validateAllowedKeys(errors, `budgets.${pattern}`, budget, ["maxIssues", "maxHigh", "maxMedium"]);
    validateNonNegativeInteger(errors, `budgets.${pattern}.maxIssues`, budget.maxIssues);
    validateNonNegativeInteger(errors, `budgets.${pattern}.maxHigh`, budget.maxHigh);
    validateNonNegativeInteger(errors, `budgets.${pattern}.maxMedium`, budget.maxMedium);
  }
}

function validateBadge(errors: string[], value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push("badge must be an object");
    return;
  }
  validateAllowedKeys(errors, "badge", value, ["greenMax", "yellowMax"]);
  validateNonNegativeInteger(errors, "badge.greenMax", value.greenMax);
  validateNonNegativeInteger(errors, "badge.yellowMax", value.yellowMax);
}

function validatePriority(errors: string[], value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push("priority must be an object");
    return;
  }
  validateAllowedKeys(errors, "priority", value, ["severity", "churn", "age"]);
  validateNonNegativeNumber(errors, "priority.churn", value.churn);
  validateNonNegativeNumber(errors, "priority.age", value.age);
  if (value.severity !== undefined) {
    if (!isPlainObject(value.severity)) {
      errors.push("priority.severity must be an object");
    } else {
      validateAllowedKeys(errors, "priority.severity", value.severity, [...severities]);
      for (const severity of severities) {
        validateNonNegativeNumber(errors, `priority.severity.${severity}`, value.severity[severity]);
      }
    }
  }
}

function validateAllowedKeys(errors: string[], prefix: string, value: Record<string, unknown>, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      errors.push(`${prefix}.${key} is not allowed`);
    }
  }
}

function validateNonNegativeInteger(errors: string[], key: string, value: unknown): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || Number(value) < 0) {
    errors.push(`${key} must be a non-negative integer`);
  }
}

function validateNonNegativeNumber(errors: string[], key: string, value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(`${key} must be a non-negative number`);
  }
}

function isNumberInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
