import path from "node:path";
import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";

/**
 * Path segments and file markers that indicate generated, test-fixture,
 * or scaffold output that should not be imported by production source.
 */
const DEFAULT_GENERATED_PATTERNS: RegExp[] = [
  /(^|\/)__generated__\//,
  /(^|\/)__mocks__\//,
  /(^|\/)__tests__\//,
  /(^|\/)__snapshots__\//,
  /(^|\/)__fixtures__\//,
  /(^|\/)\.(fixtures|mocks)\//,
  /(^|\/)fixtures\//,
  /(^|\/)test-utils\//,
  /(^|\/)testing\//,
  /\.generated(\.[cm]?[jt]sx?)?$/,
  /\.mock(\.[cm]?[jt]sx?)?$/,
];

const TEST_FILE_PATTERN = /\.(test|spec|stories|story)\.[cm]?[jt]sx?$/;
const SETUP_FILE_PATTERN = /(^|\/)(__tests__|__mocks__|__snapshots__|__fixtures__|test-utils|testing|\.fixtures|\.mocks|fixtures)\//;

function isTestFile(relativePath: string): boolean {
  return TEST_FILE_PATTERN.test(relativePath) || SETUP_FILE_PATTERN.test(relativePath);
}

function isGeneratedPath(importPath: string): boolean {
  return DEFAULT_GENERATED_PATTERNS.some((pattern) => pattern.test(importPath));
}

function hasGeneratedMarker(file: SourceFileInfo): boolean {
  const leadingText = file.content.slice(0, 500);
  return /@generated\b/.test(leadingText) || /\/\*\*?\s*AUTO[- ]?GENERATED/i.test(leadingText);
}

export const generatedCodeLeakageDetector: Detector = {
  id: "generated-code-leakage",
  name: "Generated-code leakage",
  description:
    "Flags production source files that import from generated, mock, fixture, or test directories.",
  defaultSeverity: "medium",
  tags: ["imports", "cleanup", "ai-debt", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const knownFiles = new Map<string, SourceFileInfo>();
    for (const file of context.files) {
      knownFiles.set(file.relativePath, file);
    }

    for (const file of context.files) {
      if (isTestFile(file.relativePath)) continue;

      for (const declaration of file.sourceFile.getImportDeclarations()) {
        const specifier = declaration.getModuleSpecifierValue();
        if (!specifier.startsWith(".")) continue;

        const resolvedRelative = resolveImportTarget(
          file.relativePath,
          specifier,
          knownFiles,
        );

        const importStartLine = declaration.getStartLineNumber();

        if (isGeneratedPath(specifier)) {
          issues.push(
            createIssue({
              detector: generatedCodeLeakageDetector,
              severity: "medium",
              confidence: 0.85,
              file: file.relativePath,
              location: { startLine: importStartLine },
              message: `Production file imports from a generated/test path: "${specifier}".`,
              evidence: [
                `import specifier: ${specifier}`,
                `in: ${file.relativePath}:${importStartLine}`,
              ],
              suggestion:
                "Extract the real dependency into a production module, or move the consuming code into the test tree.",
            }),
          );
          continue;
        }

        if (resolvedRelative) {
          const resolvedFile = knownFiles.get(resolvedRelative);
          if (resolvedFile && hasGeneratedMarker(resolvedFile)) {
            issues.push(
              createIssue({
                detector: generatedCodeLeakageDetector,
                severity: "medium",
                confidence: 0.75,
                file: file.relativePath,
                location: { startLine: importStartLine },
                message: `Production file imports "${specifier}", which is marked @generated.`,
                evidence: [
                  `import specifier: ${specifier}`,
                  `resolved to: ${resolvedRelative}`,
                  `marker: @generated header in target file`,
                ],
                suggestion:
                  "If this import is intentional (e.g. codegen output consumed at build time), suppress with a debtlens-disable comment. Otherwise move the dependency to a proper source module.",
              }),
            );
          }
        }
      }
    }

    return issues;
  },
};

function resolveImportTarget(
  importerPath: string,
  specifier: string,
  knownFiles: Map<string, SourceFileInfo>,
): string | undefined {
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(importerPath), specifier),
  );
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.posix.join(base, "index.ts"),
    path.posix.join(base, "index.tsx"),
    path.posix.join(base, "index.js"),
    path.posix.join(base, "index.jsx"),
  ];
  return candidates.find((c) => knownFiles.has(c));
}
