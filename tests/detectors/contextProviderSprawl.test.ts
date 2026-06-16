import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contextProviderSprawlDetector } from "../../src/detectors/contextProviderSprawl.js";
import { runDetector } from "../helpers/runDetector.js";

describe("context-provider-sprawl detector", () => {
  it("flags a component wrapping many unrelated context providers", async () => {
    const src = `
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider value={auth}>
      <ThemeContext.Provider value={theme}>
        <BillingContext.Provider value={billing}>
          <SearchContext.Provider value={search}>
            {children}
          </SearchContext.Provider>
        </BillingContext.Provider>
      </ThemeContext.Provider>
    </AuthContext.Provider>
  );
}
`;
    const issues = await runDetector(contextProviderSprawlDetector, { "AppProviders.tsx": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "context-provider-sprawl");
    assert.match(issues[0]?.message ?? "", /4 distinct Context\.Provider values/);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("AuthContext")));
  });

  it("does NOT flag a legitimate single-context provider", async () => {
    const src = `
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo(() => ({ mode, setMode }), [mode]);
  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
`;
    const issues = await runDetector(contextProviderSprawlDetector, { "ThemeProvider.tsx": src });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag non-provider JSX wrappers", async () => {
    const src = `
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Shell>
      <Header />
      <Main>{children}</Main>
      <Footer />
    </Shell>
  );
}
`;
    const issues = await runDetector(contextProviderSprawlDetector, { "Layout.tsx": src });
    assert.equal(issues.length, 0);
  });
});
