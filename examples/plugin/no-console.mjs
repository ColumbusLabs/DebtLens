// Reference DebtLens plugin: flags console.log calls in production source.
// Run it from this directory: npx debtlens scan src --rules no-console
// See docs/plugin-api-rfc.md for the plugin contract.

/** @type {import("debtlens/plugin").Detector} */
const noConsoleDetector = {
  id: "no-console",
  name: "No console",
  description: "Flags console.log in production source.",
  defaultSeverity: "low",
  tags: ["hygiene"],
  detect(context) {
    // Plugin-exported threshold default (see `thresholds` below); user config
    // `thresholds["no-console.maxCalls"]` overrides it.
    const maxCalls = context.getThreshold("no-console.maxCalls", 0);
    const issues = [];
    for (const file of context.files) {
      const lines = file.content.split(/\r?\n/);
      const matches = [];
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].includes("console.log")) matches.push(index);
      }
      if (matches.length <= maxCalls) continue;
      for (const index of matches) {
        issues.push({
          id: `dl_nc_${file.relativePath}:${index + 1}`,
          ruleId: "no-console",
          ruleName: "No console",
          severity: "low",
          confidence: 0.85,
          message: "console.log found in source.",
          file: file.relativePath,
          location: { startLine: index + 1 },
          evidence: [lines[index].trim()],
          suggestion: "Remove debug logging or route through a logger.",
          tags: ["hygiene"],
        });
      }
    }
    return issues;
  },
};

export default {
  rules: [noConsoleDetector],
  // Threshold defaults merged after built-ins, before user config and CLI flags.
  thresholds: { "no-console.maxCalls": 0 },
  // Naming-drift concept groups merged below user config `vocabulary` groups.
  vocabulary: {
    logging: ["log", "logger", "console", "debug", "trace", "print"],
  },
};
