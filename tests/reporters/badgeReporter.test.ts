import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderBadgeEndpoint, renderBadgeSvg } from "../../src/reporters/badgeReporter.js";
import type { ScanResult } from "../../src/core/types.js";

const sampleResult: ScanResult = {
  schemaVersion: 1,
  issues: [],
  summary: {
    totalIssues: 42,
    bySeverity: { high: 2, medium: 10, low: 20, info: 10 },
    byRule: {},
    filesScanned: 3,
    rulesRun: 5,
    elapsedMs: 12,
  },
  options: { target: ".", include: [], exclude: [], minSeverity: "low" },
};

describe("badge reporter", () => {
  it("renders a self-contained SVG badge", () => {
    const svg = renderBadgeSvg(sampleResult);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(svg, /42/);
    assert.doesNotMatch(svg, /<script|href="https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
  });

  it("renders a shields.io endpoint payload", () => {
    const json = JSON.parse(renderBadgeEndpoint(sampleResult)) as {
      schemaVersion: number;
      label: string;
      message: string;
      color: string;
    };
    assert.equal(json.schemaVersion, 1);
    assert.equal(json.label, "debt");
    assert.match(json.message, /42/);
    assert.ok(["brightgreen", "yellow", "red"].includes(json.color));
  });

  it("reflects configurable thresholds", () => {
    const lowDebt: ScanResult = {
      ...sampleResult,
      summary: {
        ...sampleResult.summary,
        totalIssues: 5,
        bySeverity: { high: 0, medium: 2, low: 2, info: 1 },
      },
    };
    const green = renderBadgeEndpoint(lowDebt, { thresholds: { greenMax: 100, yellowMax: 200 } });
    assert.match(green, /brightgreen/);
  });

  it("uses red when any high-severity issues exist", () => {
    const withHigh: ScanResult = {
      ...sampleResult,
      summary: {
        ...sampleResult.summary,
        bySeverity: { ...sampleResult.summary.bySeverity, high: 1 },
      },
    };
    const json = JSON.parse(renderBadgeEndpoint(withHigh)) as { color: string };
    assert.equal(json.color, "red");
  });

  it("allocates width for trend arrows", () => {
    const svg = renderBadgeSvg(sampleResult, { trend: "up" });
    assert.match(svg, /↑/);
    const widthMatch = svg.match(/width="(\d+)"/);
    assert.ok(widthMatch);
    const plain = renderBadgeSvg(sampleResult);
    const plainWidth = plain.match(/width="(\d+)"/)?.[1];
    assert.ok(Number(widthMatch[1]) > Number(plainWidth));
  });
});
