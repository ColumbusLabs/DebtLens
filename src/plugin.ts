/**
 * Public entry point for DebtLens plugin authors, published as `debtlens/plugin`.
 * Import types from here instead of internal paths; this surface is versioned by
 * DEBTLENS_PLUGIN_API_VERSION (see docs/plugin-api-rfc.md).
 *
 * @example
 * import type { Detector, DetectorContext } from "debtlens/plugin";
 */
export type {
  DebtIssue,
  Detector,
  DetectorContext,
  IssueLocation,
  ScanOptions,
  Severity,
  SourceFileInfo,
} from "./core/types.js";
export { DEBTLENS_PLUGIN_API_VERSION } from "./plugins/version.js";
