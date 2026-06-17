import assert from "node:assert/strict";
import { Project, ScriptTarget, ts } from "ts-morph";
import { describe, it } from "node:test";
import type { SourceFileInfo } from "../../src/core/types.js";
import {
  hasUseClientDirective,
  isLikelyNextServerComponentFile,
  normalizePath,
} from "../../src/utils/nextSurface.js";

function sourceFileInfo(relativePath: string, content: string): SourceFileInfo {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.ReactJSX,
      target: ScriptTarget.ES2022,
    },
  });
  const absolutePath = `/${relativePath}`;
  const sourceFile = project.createSourceFile(absolutePath, content, { overwrite: true });
  return {
    absolutePath,
    relativePath,
    content,
    language: "tsjs",
    sourceFile,
  };
}

describe("nextSurface helpers", () => {
  it("normalizes Windows-style paths", () => {
    assert.equal(normalizePath("app\\page.tsx"), "app/page.tsx");
  });

  it("detects a top-level use client directive", () => {
    const file = sourceFileInfo("Client.tsx", `"use client";\nimport { useState } from "react";\n`);
    assert.equal(hasUseClientDirective(file), true);
  });

  it("returns false when imports precede use client", () => {
    const file = sourceFileInfo("Client.tsx", `import { useState } from "react";\n"use client";\n`);
    assert.equal(hasUseClientDirective(file), false);
  });

  it("identifies likely Next server component files with JSX", () => {
    const file = sourceFileInfo("app/dashboard/page.tsx", `export default function Page() { return <main />; }\n`);
    assert.equal(isLikelyNextServerComponentFile(file), true);
  });

  it("excludes route modules from server component detection", () => {
    const file = sourceFileInfo("app/api/reports/route.ts", `export async function GET() { return Response.json({ ok: true }); }\n`);
    assert.equal(isLikelyNextServerComponentFile(file), false);
  });
});
