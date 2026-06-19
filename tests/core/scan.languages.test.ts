import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { mergeConfig } from "../../src/config/mergeConfig.js";
import { scan } from "../../src/core/scan.js";
import type { Detector } from "../../src/core/types.js";

describe("scan language-specific behavior", () => {
  it("lets test-duplication inspect test files without widening default source includes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-test-duplication-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "a.test.ts"), `
        test("creates invoice", () => {
          const invoice = createInvoice({ total: 10 });
          expect(invoice.total).toBe(10);
          expect(invoice.status).toBe("open");
        });
      `);
      writeFileSync(join(dir, "src", "b.test.ts"), `
        test("creates receipt", () => {
          const receipt = createInvoice({ total: 10 });
          expect(receipt.total).toBe(10);
          expect(receipt.status).toBe("open");
        });
      `);

      const result = await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: ["test-duplication"],
        thresholds: { ...defaultConfig.thresholds, "test-duplication.minLines": 2 },
        maxFiles: defaultConfig.maxFiles,
      });

      assert.equal(result.summary.filesScanned, 0);
      assert.equal(result.summary.totalIssues, 1);
      assert.equal(result.issues[0]?.ruleId, "test-duplication");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets the Kotlin pack discover Android Kotlin sources excluded by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-kotlin-"));
    try {
      mkdirSync(join(dir, "android", "app", "src", "main", "java", "com", "example"), { recursive: true });
      writeFileSync(join(dir, "android", "app", "src", "main", "java", "com", "example", "Billing.kt"), `
package com.example

fun renderBilling(): String {
    // TODO(PROJ-44): replace temporary billing label.
    return "billing"
}
`);

      const options = mergeConfig(".", {}, { cwd: dir, pack: "kotlin" });
      const result = await scan(options);

      assert.equal(result.summary.filesScanned, 1);
      assert.equal(result.summary.byRule["kotlin-todo-comment"], 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("routes files to plugin detectors by declared language", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-plugin-language-"));
    const seenFiles: string[] = [];
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "export const app = true;\n");
      writeFileSync(join(dir, "src", "service.py"), "def service():\n    return True\n");
      writeFileSync(join(dir, "src", "Main.kt"), "fun main() = Unit\n");

      const detector = buildRecorderDetector("policy-python-fixture", seenFiles, ["python"]);
      const result = await scan({
        cwd: dir,
        target: dir,
        include: ["**/*.{ts,py,kt}"],
        exclude: [],
        minSeverity: "low",
        rules: [detector.id],
        thresholds: defaultConfig.thresholds,
        pluginDetectors: [detector],
      });

      assert.equal(result.summary.rulesRun, 1);
      assert.deepEqual(seenFiles, ["src/service.py"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("routes detectors without languages to TS/JS files only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-default-language-"));
    const seenFiles: string[] = [];
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "export const app = true;\n");
      writeFileSync(join(dir, "src", "service.py"), "def service():\n    return True\n");
      writeFileSync(join(dir, "src", "Main.kt"), "fun main() = Unit\n");

      const detector = buildRecorderDetector("policy-tsjs-fixture", seenFiles);
      const result = await scan({
        cwd: dir,
        target: dir,
        include: ["**/*.{ts,py,kt}"],
        exclude: [],
        minSeverity: "low",
        rules: [detector.id],
        thresholds: defaultConfig.thresholds,
        pluginDetectors: [detector],
      });

      assert.equal(result.summary.rulesRun, 1);
      assert.deepEqual(seenFiles, ["src/app.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not spend a pure Kotlin pack maxFiles budget on Android JavaScript files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-kotlin-maxfiles-"));
    try {
      mkdirSync(join(dir, "android", "app", "src", "main", "java", "com", "example"), { recursive: true });
      writeFileSync(join(dir, "android", "app", "src", "main", "java", "com", "example", "0Generated.js"), `
export const generated = true;
`);
      writeFileSync(join(dir, "android", "app", "src", "main", "java", "com", "example", "ZBilling.kt"), `
package com.example

fun renderBilling(): String {
    // TODO(PROJ-45): replace generated billing label.
    return "billing"
}
`);

      const options = mergeConfig(".", {}, { cwd: dir, pack: "kotlin", maxFiles: 1 });
      const result = await scan(options);

      assert.deepEqual(options.include, ["**/*.{kt,kts}"]);
      assert.equal(result.summary.filesScanned, 1);
      assert.equal(result.summary.byRule["kotlin-todo-comment"], 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not spend a mixed Kotlin pack maxFiles budget on Android JavaScript files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-mixed-kotlin-maxfiles-"));
    try {
      mkdirSync(join(dir, "android", "app", "src", "main", "java", "com", "example"), { recursive: true });
      writeFileSync(join(dir, "android", "app", "src", "main", "java", "com", "example", "0Generated.js"), `
export const generated = true;
`);
      writeFileSync(join(dir, "android", "app", "src", "main", "java", "com", "example", "ZBilling.kt"), `
package com.example

fun renderBilling(): String {
    // TODO(PROJ-46): replace mixed-pack billing label.
    return "billing"
}
`);

      const options = mergeConfig(".", {}, { cwd: dir, pack: "react-native,kotlin", maxFiles: 1 });
      const result = await scan(options);

      assert.ok(options.include.includes("**/*.{ts,tsx,js,jsx}"));
      assert.ok(options.include.includes("**/*.{kt,kts}"));
      assert.ok(options.exclude.includes("android/**/*.{ts,tsx,js,jsx}"));
      assert.equal(options.exclude.includes("android/**"), false);
      assert.equal(result.summary.filesScanned, 1);
      assert.equal(result.summary.byRule["kotlin-todo-comment"], 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets the Compose pack discover Android Kotlin sources excluded by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-compose-"));
    try {
      mkdirSync(join(dir, "android", "app", "src", "main", "java", "com", "example"), { recursive: true });
      writeFileSync(join(dir, "android", "app", "src", "main", "java", "com", "example", "BillingScreen.kt"), `
package com.example

@Composable
fun BillingScreen() {
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    var selectedCustomer by remember { mutableStateOf<String?>(null) }
    var showOverdue by remember { mutableStateOf(false) }
    var sortOrder by rememberSaveable { mutableStateOf("dueDate") }
    Column { Text(query) }
}
`);

      const options = mergeConfig(".", {}, { cwd: dir, pack: "compose" });
      const result = await scan(options);

      assert.equal(result.summary.filesScanned, 1);
      assert.equal(result.summary.byRule["compose-state-hoisting"], 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not spend a pure Compose pack maxFiles budget on Android JavaScript files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-compose-maxfiles-"));
    try {
      mkdirSync(join(dir, "android", "app", "src", "main", "java", "com", "example"), { recursive: true });
      writeFileSync(join(dir, "android", "app", "src", "main", "java", "com", "example", "0Generated.js"), `
export const generated = true;
`);
      writeFileSync(join(dir, "android", "app", "src", "main", "java", "com", "example", "ZBillingScreen.kt"), `
package com.example

@Composable
fun BillingScreen() {
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    var selectedCustomer by remember { mutableStateOf<String?>(null) }
    var showOverdue by remember { mutableStateOf(false) }
    var sortOrder by rememberSaveable { mutableStateOf("dueDate") }
    Column { Text(query) }
}
`);

      const options = mergeConfig(".", {}, { cwd: dir, pack: "compose", maxFiles: 1 });
      const result = await scan(options);

      assert.deepEqual(options.include, ["**/*.{kt,kts}"]);
      assert.equal(result.summary.filesScanned, 1);
      assert.equal(result.summary.byRule["compose-state-hoisting"], 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function buildRecorderDetector(
  id: string,
  seenFiles: string[],
  languages?: Detector["languages"],
): Detector {
  return {
    id,
    name: id,
    description: id,
    defaultSeverity: "low",
    tags: ["test"],
    ...(languages ? { languages } : {}),
    detect(context) {
      seenFiles.push(...context.files.map((file) => file.relativePath).sort());
      return [];
    },
  };
}
