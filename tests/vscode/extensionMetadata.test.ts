import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const manifestPath = "extensions/vscode/package.json";
const extensionPath = "extensions/vscode/extension.js";

describe("VS Code extension metadata", () => {
  it("declares the diagnostic command, activation events, and settings", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      activationEvents: string[];
      contributes: {
        commands: Array<{ command: string }>;
        configuration: { properties: Record<string, unknown> };
      };
      main: string;
    };

    assert.equal(manifest.main, "./extension.js");
    assert.ok(manifest.activationEvents.includes("onCommand:debtlens.scanWorkspace"));
    assert.ok(manifest.activationEvents.includes("workspaceContains:debtlens.config.json"));
    assert.ok(manifest.contributes.commands.some((command) => command.command === "debtlens.scanWorkspace"));
    assert.ok(manifest.contributes.configuration.properties["debtlens.executable"]);
    assert.ok(manifest.contributes.configuration.properties["debtlens.scanOnSave"]);
    assert.ok(manifest.contributes.configuration.properties["debtlens.extraArgs"]);
  });

  it("has syntactically valid extension JavaScript that maps JSON findings to diagnostics", () => {
    execFileSync(process.execPath, ["--check", extensionPath], { stdio: "pipe" });
    const source = readFileSync(extensionPath, "utf8");

    assert.match(source, /createDiagnosticCollection\("debtlens"\)/);
    assert.match(source, /cp\.spawn\(executable, args/);
    assert.match(source, /JSON\.parse\(stdout\)/);
    assert.match(source, /collection\.set\(uri, diagnostics\)/);
  });
});
