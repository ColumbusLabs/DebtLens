import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stateSprawlDetector } from "../../src/detectors/stateSprawl.js";
import { runDetector } from "../helpers/runDetector.js";

const SPRAWL = `
export function Dashboard() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [d, setD] = useState(0);
  const [e, setE] = useState(0);
  const [f, setF] = useState(0);
  const [g, setG] = useState(0);
  return <div>{a}{b}{c}{d}{e}{f}{g}</div>;
}
`;

describe("state-sprawl detector", () => {
  it("flags a component with more stateful hooks than the threshold", async () => {
    const issues = await runDetector(stateSprawlDetector, { "Dashboard.tsx": SPRAWL });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "state-sprawl");
    assert.match(issues[0]?.message ?? "", /7 stateful hook calls/);
  });

  it("does NOT flag a component at the boundary (one below threshold)", async () => {
    const sixHooks = `
export function Panel() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [d, setD] = useState(0);
  const [e, setE] = useState(0);
  return <div>{a}{b}{c}{d}{e}</div>;
}
`;
    const issues = await runDetector(stateSprawlDetector, { "Panel.tsx": sixHooks });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag a plain (non-component) function with many useState-looking calls", async () => {
    // lowercase name => classified as "function", which the detector skips
    const helper = `
function buildState() {
  const a = useState(0);
  const b = useState(0);
  const c = useState(0);
  const d = useState(0);
  const e = useState(0);
  const f = useState(0);
  const g = useState(0);
  return [a, b, c, d, e, f, g];
}
`;
    const issues = await runDetector(stateSprawlDetector, { "helper.ts": helper });
    assert.equal(issues.length, 0);
  });

  it("respects a custom threshold override", async () => {
    const issues = await runDetector(
      stateSprawlDetector,
      { "Dashboard.tsx": SPRAWL },
      { thresholds: { "state-sprawl.maxStatefulHooks": 10 } },
    );
    assert.equal(issues.length, 0);
  });
});
