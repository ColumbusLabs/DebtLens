import type { Project } from "ts-morph";
import type { Detector, SourceFileInfo, SourceLanguage } from "./types.js";
import { buildSfcVirtualScriptContent, getSfcVirtualScriptExtension } from "../utils/sfc.js";

export const DEFAULT_SOURCE_LANGUAGE: SourceLanguage = "tsjs";

export interface LanguageDefinition {
  id: SourceLanguage;
  label: string;
  extensions: string[];
  includeGlobs: string[];
  ruleIdPrefixes: string[];
  parseSourceFile: (input: LanguageParseInput) => SourceFileInfo;
  defaultExcludeRewrites?: Record<string, string[]>;
}

export interface LanguageParseInput {
  project: Project;
  absolutePath: string;
  relativePath: string;
  content: string;
  language: SourceLanguage;
}

function parseWithTsMorph(input: LanguageParseInput): SourceFileInfo {
  return {
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    content: input.content,
    language: input.language,
    sourceFile: input.project.createSourceFile(input.absolutePath, input.content, { overwrite: true }),
  };
}

function parseTextOnly(input: LanguageParseInput): SourceFileInfo {
  return {
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    content: input.content,
    language: input.language,
    sourceFile: input.project.createSourceFile(input.absolutePath, "", { overwrite: true }),
  };
}

function parseSfcWithTsMorph(input: LanguageParseInput): SourceFileInfo {
  const virtualExtension = getSfcVirtualScriptExtension(input.content);
  return {
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    content: input.content,
    language: input.language,
    sourceFile: input.project.createSourceFile(
      `${input.absolutePath}.__debtlens.${input.language}${virtualExtension}`,
      buildSfcVirtualScriptContent(input.content),
      { overwrite: true },
    ),
  };
}

export const LANGUAGE_DEFINITIONS: Record<SourceLanguage, LanguageDefinition> = {
  tsjs: {
    id: "tsjs",
    label: "TypeScript/JavaScript",
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    includeGlobs: ["**/*.{ts,tsx,js,jsx}"],
    ruleIdPrefixes: [],
    parseSourceFile: parseWithTsMorph,
  },
  python: {
    id: "python",
    label: "Python",
    extensions: [".py"],
    includeGlobs: ["**/*.py"],
    ruleIdPrefixes: ["python-"],
    parseSourceFile: parseTextOnly,
  },
  kotlin: {
    id: "kotlin",
    label: "Kotlin",
    extensions: [".kt", ".kts"],
    includeGlobs: ["**/*.{kt,kts}"],
    ruleIdPrefixes: ["kotlin-", "compose-"],
    parseSourceFile: parseTextOnly,
    defaultExcludeRewrites: {
      "android/**": ["android/**/*.{ts,tsx,js,jsx}"],
    },
  },
  swift: {
    id: "swift",
    label: "Swift",
    extensions: [".swift"],
    includeGlobs: ["**/*.swift"],
    ruleIdPrefixes: ["swift-", "swiftui-"],
    parseSourceFile: parseTextOnly,
    defaultExcludeRewrites: {
      "ios/**": ["ios/**/*.{ts,tsx,js,jsx}"],
    },
  },
  ruby: {
    id: "ruby",
    label: "Ruby",
    extensions: [".rb"],
    includeGlobs: ["**/*.rb"],
    ruleIdPrefixes: ["ruby-", "rails-"],
    parseSourceFile: parseTextOnly,
  },
  vue: {
    id: "vue",
    label: "Vue",
    extensions: [".vue"],
    includeGlobs: ["**/*.vue"],
    ruleIdPrefixes: ["vue-"],
    parseSourceFile: parseSfcWithTsMorph,
  },
  svelte: {
    id: "svelte",
    label: "Svelte",
    extensions: [".svelte"],
    includeGlobs: ["**/*.svelte"],
    ruleIdPrefixes: ["svelte-"],
    parseSourceFile: parseSfcWithTsMorph,
  },
};

export const SUPPORTED_SOURCE_LANGUAGES = Object.freeze(
  Object.keys(LANGUAGE_DEFINITIONS) as SourceLanguage[],
);

const definitions = Object.values(LANGUAGE_DEFINITIONS);

export function getLanguageDefinition(id: SourceLanguage): LanguageDefinition {
  return LANGUAGE_DEFINITIONS[id];
}

export function isSourceLanguage(value: unknown): value is SourceLanguage {
  return typeof value === "string" && value in LANGUAGE_DEFINITIONS;
}

export function detectSourceLanguage(path: string): SourceLanguage {
  const lowerPath = path.toLowerCase();
  return definitions.find((definition) =>
    definition.extensions.some((extension) => lowerPath.endsWith(extension)))?.id
    ?? DEFAULT_SOURCE_LANGUAGE;
}

export function parseSourceFile(input: LanguageParseInput): SourceFileInfo {
  return getLanguageDefinition(input.language).parseSourceFile(input);
}

export function languagesForDetector(detector: Detector): SourceLanguage[] {
  return detector.languages ?? [DEFAULT_SOURCE_LANGUAGE];
}

export function includeGlobsForLanguages(languages: SourceLanguage[]): string[] {
  return unique(languages.flatMap((language) => getLanguageDefinition(language).includeGlobs));
}

export function rewriteDefaultExcludesForLanguages(
  languages: SourceLanguage[],
  excludePatterns: string[],
): string[] {
  const rewrites = new Map<string, string[]>();
  for (const language of languages) {
    for (const [pattern, replacements] of Object.entries(getLanguageDefinition(language).defaultExcludeRewrites ?? {})) {
      rewrites.set(pattern, replacements);
    }
  }

  return unique(excludePatterns.flatMap((pattern) => rewrites.get(pattern) ?? [pattern]));
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
