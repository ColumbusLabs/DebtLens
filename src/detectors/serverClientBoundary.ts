import { Node, SyntaxKind } from "ts-morph";
import type { CallExpression } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { hasUseClientDirective, isLikelyNextServerComponentFile, normalizePath } from "../utils/nextSurface.js";
import { nodeLineSpan } from "../utils/lines.js";

const CLIENT_ONLY_HOOKS = new Set([
  "useCallback",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useEffect",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useOptimistic",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
]);

const SERVER_ONLY_IMPORTS = new Set([
  "server-only",
  "next/cache",
  "next/headers",
  "next/server",
  "fs",
  "fs/promises",
  "child_process",
  "cluster",
  "dgram",
  "dns",
  "http",
  "http2",
  "https",
  "module",
  "net",
  "os",
  "process",
  "readline",
  "tls",
  "worker_threads",
  "zlib",
]);

export const serverClientBoundaryDetector: Detector = {
  id: "server-client-boundary",
  name: "Server/client boundary",
  description: "Flags likely Next.js server/client boundary mistakes in App Router files.",
  defaultSeverity: "high",
  tags: ["next", "react", "server-components", "module-boundaries"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      if (isExpoOrReactNativeSurface(file)) continue;

      const isClientFile = hasUseClientDirective(file);
      if (isClientFile) {
        const serverImports = collectServerOnlyImports(file);
        if (serverImports.length > 0) {
          const firstImport = serverImports[0];
          issues.push(createIssue({
            detector: serverClientBoundaryDetector,
            severity: "high",
            confidence: 0.9,
            file: file.relativePath,
            location: firstImport?.location,
            message: `${file.relativePath} is marked "use client" but imports server-only modules.`,
            evidence: serverImports.map((item) => `Import: ${item.moduleName}`),
            suggestion: "Move the server-only import behind a server component, route handler, or server action, and pass serializable data into the client component.",
          }));
        }
        continue;
      }

      if (!isLikelyNextServerComponentFile(file)) continue;

      const hookCalls = collectClientHookCalls(file);
      if (hookCalls.length === 0) continue;

      const uniqueHooks = [...new Set(hookCalls.map((item) => item.hookName))];
      issues.push(createIssue({
        detector: serverClientBoundaryDetector,
        severity: "high",
        confidence: 0.86,
        file: file.relativePath,
        location: hookCalls[0]?.location,
        message: `${file.relativePath} looks like a server component but calls client-only React hooks.`,
        evidence: [
          `Hooks: ${uniqueHooks.join(", ")}`,
          "No \"use client\" directive found",
        ],
        suggestion: "Add a focused client component boundary for interactive state/effects, or move the hook usage into a file with a top-level \"use client\" directive.",
      }));
    }

    return issues;
  },
};

function isExpoOrReactNativeSurface(file: SourceFileInfo): boolean {
  return file.sourceFile.getImportDeclarations().some((declaration) => {
    const moduleName = declaration.getModuleSpecifierValue();
    return moduleName === "expo-router"
      || moduleName === "react-native"
      || moduleName.startsWith("expo-")
      || moduleName.startsWith("@react-navigation/");
  });
}

function collectServerOnlyImports(file: SourceFileInfo): Array<{ moduleName: string; location: { startLine: number; endLine: number } }> {
  const imports: Array<{ moduleName: string; location: { startLine: number; endLine: number } }> = [];

  for (const declaration of file.sourceFile.getImportDeclarations()) {
    const moduleName = declaration.getModuleSpecifierValue();
    if (!isServerOnlyModule(moduleName)) continue;
    const span = nodeLineSpan(declaration);
    imports.push({
      moduleName,
      location: { startLine: span.startLine, endLine: span.endLine },
    });
  }

  return imports;
}

function isServerOnlyModule(moduleName: string): boolean {
  if (SERVER_ONLY_IMPORTS.has(moduleName)) return true;
  if (moduleName.startsWith("node:")) return SERVER_ONLY_IMPORTS.has(moduleName.slice("node:".length));
  return false;
}

function collectClientHookCalls(file: SourceFileInfo): Array<{ hookName: string; location: { startLine: number; endLine: number } }> {
  const calls: Array<{ hookName: string; location: { startLine: number; endLine: number } }> = [];

  for (const call of file.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const hookName = getClientHookName(call);
    if (!hookName) continue;
    const span = nodeLineSpan(call);
    calls.push({
      hookName,
      location: { startLine: span.startLine, endLine: span.endLine },
    });
  }

  return calls;
}

function getClientHookName(call: CallExpression): string | undefined {
  const expression = call.getExpression();
  const name = Node.isIdentifier(expression)
    ? expression.getText()
    : Node.isPropertyAccessExpression(expression)
      ? expression.getName()
      : undefined;

  return name && CLIENT_ONLY_HOOKS.has(name) ? name : undefined;
}
