import { Node, SyntaxKind } from "ts-morph";
import type { Node as MorphNode } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../core/types.js";
import { collectFunctionLikes, countBranches, getFunctionBody } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { hasUseClientDirective, normalizePath } from "../utils/nextSurface.js";
import { nodeLineSpan } from "../utils/lines.js";

interface LoaderCandidate {
  name: string;
  body: MorphNode;
  file: SourceFileInfo;
}

export const dataLoaderSprawlDetector: Detector = {
  id: "data-loader-sprawl",
  name: "Data loader sprawl",
  description: "Flags async server components and loaders with many data-fetching operations.",
  defaultSeverity: "medium",
  tags: ["next", "server-components", "data-loading", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxAwaits = context.getThreshold("data-loader-sprawl.maxAwaits", 6);
    const maxFetches = context.getThreshold("data-loader-sprawl.maxFetches", 5);
    const maxBranches = context.getThreshold("data-loader-sprawl.maxBranches", 5);
    const maxLines = context.getThreshold("data-loader-sprawl.maxLines", 90);

    for (const file of context.files) {
      if (hasUseClientDirective(file)) continue;

      const isServerComponentSurface = isLikelyNextServerSurface(file);
      for (const candidate of collectAsyncLoaderCandidates(file)) {
        if (!isServerComponentSurface && !isLoaderLikeName(candidate.name, file)) continue;

        const awaitCount = candidate.body.getDescendantsOfKind(SyntaxKind.AwaitExpression).length;
        const fetchCount = countFetchCalls(candidate.body);
        const branchCount = countBranches(candidate.body);
        const span = nodeLineSpan(candidate.body);
        const overAwaits = awaitCount >= maxAwaits;
        const overFetches = fetchCount >= maxFetches;
        const overShape = branchCount >= maxBranches || span.lines >= maxLines;
        if (!overAwaits && !overFetches && !overShape) continue;

        const severity = overAwaits && overFetches && overShape ? "high" : "medium";
        issues.push(createIssue({
          detector: dataLoaderSprawlDetector,
          severity,
          confidence: confidenceForLoader(fetchCount, awaitCount, span.lines, maxFetches, maxAwaits, maxLines),
          file: file.relativePath,
          location: { startLine: span.startLine, endLine: span.endLine },
          message: `${candidate.name} performs ${awaitCount} awaits and ${fetchCount} fetch calls in one server-side loader path.`,
          evidence: [
            `Await expressions: ${awaitCount} / ${maxAwaits}`,
            `Fetch calls: ${fetchCount} / ${maxFetches}`,
            `Branch points: ${branchCount} / ${maxBranches}`,
            `Lines: ${span.lines} / ${maxLines}`,
          ],
          suggestion: "Split independent data requirements into focused loaders, colocate fetching with the route segment that owns it, or batch related requests behind a single server helper.",
        }));
      }
    }

    return issues;
  },
};

function collectAsyncLoaderCandidates(file: SourceFileInfo): LoaderCandidate[] {
  const candidates: LoaderCandidate[] = [];

  for (const fn of collectFunctionLikes(file)) {
    if (!isAsyncFunctionNode(fn.node)) continue;
    const body = getFunctionBody(fn.node);
    if (!body) continue;
    candidates.push({ name: fn.name, body, file });
  }

  for (const declaration of file.sourceFile.getFunctions()) {
    if (declaration.getName()) continue;
    if (!isAsyncFunctionNode(declaration)) continue;
    const body = declaration.getBody();
    if (!body) continue;
    candidates.push({ name: "default export", body, file });
  }

  return candidates;
}

function isAsyncFunctionNode(node: MorphNode): boolean {
  const modifiers = "getModifiers" in node
    ? (node as { getModifiers: () => Array<{ getKind: () => SyntaxKind }> }).getModifiers()
    : [];

  return modifiers.some((modifier) => modifier.getKind() === SyntaxKind.AsyncKeyword)
    || node.getText().trimStart().startsWith("async ");
}

function isLikelyNextServerSurface(file: SourceFileInfo): boolean {
  const path = normalizePath(file.relativePath);
  return /(^|\/)app\/.+\.[cm]?[jt]sx?$/.test(path) && !/(^|\/)app\/.*\/route\.[cm]?[jt]sx?$/.test(path);
}

function isLoaderLikeName(name: string, file: SourceFileInfo): boolean {
  const path = normalizePath(file.relativePath);
  return /(?:loader|load|fetch|get|query|hydrate|resolve)/i.test(name)
    || /(^|\/)(loaders?|data|server)\//.test(path);
}

function countFetchCalls(node: MorphNode): number {
  return node.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    const expression = call.getExpression();
    if (Node.isIdentifier(expression)) return expression.getText() === "fetch";
    if (Node.isPropertyAccessExpression(expression)) return expression.getName() === "fetch";
    return false;
  }).length;
}

function confidenceForLoader(
  fetchCount: number,
  awaitCount: number,
  lines: number,
  maxFetches: number,
  maxAwaits: number,
  maxLines: number,
): number {
  const operationPressure = Math.max(fetchCount / Math.max(1, maxFetches), awaitCount / Math.max(1, maxAwaits));
  const linePressure = lines / Math.max(1, maxLines);
  return Math.min(0.92, 0.64 + Math.min(0.18, operationPressure * 0.08) + Math.min(0.1, linePressure * 0.06));
}
