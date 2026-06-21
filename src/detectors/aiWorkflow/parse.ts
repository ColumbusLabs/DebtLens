import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { DetectorContext, SourceFileInfo } from "../../core/types.js";

export const INSTRUCTION_FILE_GLOBS = [
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "**/.github/copilot-instructions.md",
  "**/.cursor/rules/**/*.md",
  "**/.cursor/rules/**/*.mdc",
] as const;

export interface InstructionBlock {
  text: string;
  normalized: string;
  startLine: number;
}

export interface InstructionFile {
  relativePath: string;
  content: string;
}

const INSTRUCTION_FILE_PATTERNS = [
  /(?:^|\/)AGENTS\.md$/i,
  /(?:^|\/)CLAUDE\.md$/i,
  /(?:^|\/)\.github\/copilot-instructions\.md$/i,
  /(?:^|\/)\.cursor\/rules\/.+\.(?:md|mdc)$/i,
];

export function isInstructionFile(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return INSTRUCTION_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function resolveInstructionFiles(
  context: DetectorContext,
  maxFiles = 50,
): InstructionFile[] {
  const scopedPaths = context.options.changedFiles;
  const fromContext = context.files
    .filter((file) => isInstructionFile(file.relativePath))
    .filter((file) => !scopedPaths?.length || scopedPaths.includes(file.relativePath))
    .map((file) => ({
      relativePath: file.relativePath,
      content: resolveInstructionContent(context, file.relativePath, file.content),
    }))
    .slice(0, maxFiles);

  if (fromContext.length >= maxFiles || scopedPaths?.length) return fromContext;

  const seen = new Set(fromContext.map((file) => file.relativePath));
  const discovered = discoverInstructionFiles(context, maxFiles - fromContext.length);
  for (const file of discovered) {
    if (seen.has(file.relativePath)) continue;
    seen.add(file.relativePath);
    fromContext.push(file);
    if (fromContext.length >= maxFiles) break;
  }

  return fromContext;
}

function resolveInstructionContent(
  context: DetectorContext,
  relativePath: string,
  fallback: string,
): string {
  return context.options.fileContents?.[relativePath] ?? fallback;
}

function discoverInstructionFiles(context: DetectorContext, limit: number): InstructionFile[] {
  if (limit <= 0) return [];
  if (!isAbsolute(context.options.target) || !existsSync(context.options.target)) return [];

  const stats = statSync(context.options.target);
  const absolutePaths = stats.isFile()
    ? [context.options.target]
    : collectInstructionPaths(context.options.target, context.options.exclude, limit);

  return absolutePaths
    .map((absolutePath) => {
      const relativePath = stats.isFile()
        ? basename(absolutePath)
        : relative(context.options.target, absolutePath).replaceAll("\\", "/");
      if (!isInstructionFile(relativePath)) return undefined;
      const override = context.options.fileContents?.[relativePath];
      return {
        relativePath,
        content: override ?? readFileSync(resolve(absolutePath), "utf8"),
      };
    })
    .filter((file): file is InstructionFile => file !== undefined);
}

function collectInstructionPaths(root: string, exclude: string[], limit: number): string[] {
  const paths: string[] = [];

  const visit = (directory: string) => {
    if (paths.length >= limit) return;

    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (paths.length >= limit) break;
      const absolutePath = resolve(directory, entry.name);
      const relativePath = relative(root, absolutePath).replaceAll("\\", "/");
      if (isExcluded(relativePath, exclude)) continue;

      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        if (isInstructionFile(relativePath)) paths.push(absolutePath);
      }
    }
  };

  visit(root);
  return paths;
}

function isExcluded(path: string, exclude: string[]): boolean {
  return exclude.some((glob) => {
    if (glob.endsWith("/**") && path === glob.slice(0, -3)) return true;
    return globMatches(path, glob);
  });
}

function globMatches(path: string, glob: string): boolean {
  let expression = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      expression += ".*";
      index += 1;
    } else if (char === "*") {
      expression += "[^/]*";
    } else {
      expression += escapeRegExp(char ?? "");
    }
  }
  return new RegExp(`^${expression}$`).test(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function normalizeInstructionBlock(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function extractInstructionBlocks(content: string, minLength = 24): InstructionBlock[] {
  const blocks: InstructionBlock[] = [];
  const lines = content.split(/\r?\n/);
  let current: string[] = [];
  let startLine = 1;

  const flush = (endLine: number) => {
    const text = current.join("\n").trim();
    current = [];
    if (!text) return;
    const normalized = normalizeInstructionBlock(text);
    if (normalized.length < minLength) return;
    blocks.push({ text, normalized, startLine });
    startLine = endLine + 1;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    const isBoundary = line.trim() === "" || /^#{1,6}\s+/.test(line);

    if (isBoundary) {
      if (current.length > 0) flush(lineNumber);
      if (/^#{1,6}\s+/.test(line)) {
        startLine = lineNumber;
        current.push(line);
      } else {
        startLine = lineNumber + 1;
      }
      continue;
    }

    if (current.length === 0) startLine = lineNumber;
    current.push(line);
  }

  if (current.length > 0) flush(lines.length);
  return blocks;
}

export function instructionFilesFromContext(files: SourceFileInfo[]): InstructionFile[] {
  return files
    .filter((file) => isInstructionFile(file.relativePath))
    .map((file) => ({ relativePath: file.relativePath, content: file.content }));
}
