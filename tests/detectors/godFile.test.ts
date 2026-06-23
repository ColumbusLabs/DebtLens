import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { godFileDetector } from "../../src/detectors/godFile.js";
import { runDetector } from "../helpers/runDetector.js";

describe("god-file detector", () => {
  it("flags a kitchen-sink module with multiple sprawl axes", async () => {
    const exports = Array.from({ length: 12 }, (_, index) => `export function fn${index}() { return ${index}; }`).join("\n");
    const imports = `
import fs from "node:fs";
import React from "react";
import express from "express";
`;
    const src = `${imports}\n${exports}\n${"// filler\n".repeat(420)}`;
    const issues = await runDetector(godFileDetector, { "kitchen.ts": src }, {
      thresholds: {
        "god-file.maxLines": 200,
        "god-file.maxExports": 8,
        "god-file.maxTopLevelDecls": 8,
        "god-file.minAxes": 3,
      },
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "god-file");
    assert.ok((issues[0]?.confidence ?? 0) >= 0.7);
  });

  it("does not flag a large but cohesive single-purpose module", async () => {
    const helpers = Array.from({ length: 8 }, (_, index) => `
export function normalizeField${index}(value: string) {
  return value.trim().toLowerCase();
}`).join("\n");
    const src = `${helpers}\n${"// keep helpers together\n".repeat(40)}`;
    const issues = await runDetector(godFileDetector, { "normalize.ts": src }, {
      thresholds: {
        "god-file.maxLines": 500,
        "god-file.maxExports": 20,
        "god-file.maxTopLevelDecls": 20,
        "god-file.minAxes": 4,
      },
    });
    assert.equal(issues.length, 0);
  });
});
