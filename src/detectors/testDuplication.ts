import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import fg from "fast-glob";
import { Node, SyntaxKind } from "ts-morph";
import type { CallExpression } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../core/types.js";
import { structuralFingerprint } from "../utils/ast.js";
import { buildChangedPathScope, isChangedPath, isSourceFileChanged } from "../utils/changedScope.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";
import { cosineSimilarity, jaccard, normalizeSnippet, shingle } from "../utils/similarity.js";

interface TestFile {
  file: SourceFileInfo;
  changed: boolean;
}

interface TestSnippet {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  normalized: string;
  shingles: Set<string>;
  fingerprint: Map<string, number>;
  changed: boolean;
}

export const testDuplicationDetector: Detector = {
  id: "test-duplication",
  name: "Test duplication",
  description: "Flags structurally identical test cases across test files while ignoring parameterized tests.",
  defaultSeverity: "medium",
  tags: ["tests", "duplication", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const minSimilarity = context.getThreshold("test-duplication.minSimilarity", 0.88);
    const minStructural = context.getThreshold("test-duplication.minStructuralSimilarity", 0.72);
    const minLines = context.getThreshold("test-duplication.minLines", 3);
    const changedScoped = context.options.changedFiles !== undefined;
    const snippets: TestSnippet[] = [];

    for (const file of collectTestFiles(context)) {
      for (const call of file.file.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const snippet = buildTestSnippet(file.file.relativePath, call, minLines, file.changed);
        if (snippet) snippets.push(snippet);
      }
    }

    const issues: DebtIssue[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < snippets.length; i += 1) {
      for (let j = i + 1; j < snippets.length; j += 1) {
        const a = snippets[i];
        const b = snippets[j];
        if (!a || !b || a.file === b.file) continue;
        if (changedScoped && !a.changed && !b.changed) continue;
        const structural = cosineSimilarity(a.fingerprint, b.fingerprint);
        if (structural < minStructural) continue;
        const similarity = jaccard(a.shingles, b.shingles);
        if (similarity < minSimilarity) continue;
        const primary = changedScoped && b.changed && !a.changed ? b : a;
        const match = primary === a ? b : a;
        const key = [a.file, a.startLine, b.file, b.startLine].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push(createIssue({
          detector: testDuplicationDetector,
          severity: similarity > 0.94 ? "high" : "medium",
          confidence: Math.min(0.97, similarity),
          file: primary.file,
          location: { startLine: primary.startLine, endLine: primary.endLine },
          message: `${primary.name} is ${Math.round(similarity * 100)}% similar to ${match.name}.`,
          evidence: [
            `${primary.file}:${primary.startLine}-${primary.endLine}`,
            `${match.file}:${match.startLine}-${match.endLine}`,
          ],
          suggestion: "Extract a shared test helper or convert the duplicated assertions into a table-driven test when the scenarios are intentionally parallel.",
        }));
      }
    }

    return issues.slice(0, 50);
  },
};

function isTestFile(path: string): boolean {
  return /(?:^|\/)(__tests__\/|.*\.(?:test|spec)\.[tj]sx?$)/.test(path);
}

function collectTestFiles(context: DetectorContext): TestFile[] {
  const changedScope = buildChangedPathScope(context.options);
  const files = context.files
    .filter((file) => isTestFile(file.relativePath))
    .map((file) => ({ file, changed: isSourceFileChanged(changedScope, file) }));
  const seen = new Set(files.map((file) => file.file.relativePath));
  if (!isAbsolute(context.options.target) || !existsSync(context.options.target) || statSync(context.options.target).isFile()) return files;

  const ignore = context.options.exclude.filter((pattern) =>
    !pattern.includes("*.test")
    && !pattern.includes("*.spec")
    && !pattern.includes("__tests__"),
  );
  const paths = fg.sync(["**/*.{test,spec}.{ts,tsx,js,jsx}", "**/__tests__/**/*.{ts,tsx,js,jsx}"], {
    cwd: context.options.target,
    absolute: true,
    onlyFiles: true,
    ignore,
    dot: false,
    unique: true,
  });

  for (const absolutePath of paths) {
    const relativePath = relative(context.options.target, absolutePath).replaceAll("\\", "/");
    if (seen.has(relativePath)) continue;
    const content = readFileSync(absolutePath, "utf8");
    const sourceFile = context.project.createSourceFile(absolutePath, content, { overwrite: true });
    files.push({
      file: { absolutePath, relativePath, content, language: "tsjs", sourceFile },
      changed: isChangedPath(changedScope, relativePath, absolutePath),
    });
    seen.add(relativePath);
  }

  return files;
}

function buildTestSnippet(file: string, call: CallExpression, minLines: number, changed: boolean): TestSnippet | undefined {
  const expression = call.getExpression();
  const expressionText = expression.getText();
  if (!/^(?:it|test)(?:\.only|\.skip)?$/.test(expressionText)) return undefined;
  if (expressionText.includes(".each")) return undefined;
  const [nameArg, bodyArg] = call.getArguments();
  if (!bodyArg || (!Node.isArrowFunction(bodyArg) && !Node.isFunctionExpression(bodyArg))) return undefined;
  const body = bodyArg.getBody();
  const span = nodeLineSpan(body);
  if (span.lines < minLines) return undefined;
  const name = nameArg && Node.isStringLiteral(nameArg) ? nameArg.getLiteralText() : "test case";
  const normalized = normalizeSnippet(body.getText());
  if (normalized.length < 40) return undefined;
  return {
    name,
    file,
    startLine: span.startLine,
    endLine: span.endLine,
    normalized,
    shingles: shingle(normalized),
    fingerprint: structuralFingerprint(body),
    changed,
  };
}
