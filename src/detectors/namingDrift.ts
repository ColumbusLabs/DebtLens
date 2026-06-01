import { SyntaxKind } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { splitIdentifier } from "../utils/identifiers.js";

interface ConceptGroup {
  id: string;
  label: string;
  variants: string[];
}

// Built-in "media/release" vocabulary pack. Projects in other domains can add their
// own concept groups via the `vocabulary` config (config groups override built-ins
// that share an id).
const defaultConceptGroups: ConceptGroup[] = [
  {
    id: "media-entity",
    label: "media entity",
    variants: ["movie", "film", "show", "series", "title", "release", "media", "content", "game", "episode"],
  },
  {
    id: "time-of-release",
    label: "release timing",
    variants: ["date", "air", "premiere", "launch", "drop", "release", "available", "calendar", "upcoming"],
  },
  {
    id: "saved-user-item",
    label: "saved user item",
    variants: ["saved", "favorite", "favourite", "watchlist", "tracked", "bookmark", "following", "library"],
  },
  {
    id: "data-source",
    label: "data source",
    variants: ["api", "client", "service", "provider", "adapter", "source", "repository", "store"],
  },
];

function humanizeId(id: string): string {
  return id.replace(/[-_]+/g, " ").trim();
}

/** Merge the built-in pack with user-supplied vocabulary; config groups win on id. */
export function resolveConceptGroups(vocabulary?: Record<string, string[]>): ConceptGroup[] {
  const groups = new Map<string, ConceptGroup>();
  for (const group of defaultConceptGroups) groups.set(group.id, group);
  if (vocabulary) {
    for (const [id, variants] of Object.entries(vocabulary)) {
      groups.set(id, {
        id,
        label: humanizeId(id),
        variants: variants.map((variant) => variant.toLowerCase()),
      });
    }
  }
  return [...groups.values()];
}

export const namingDriftDetector: Detector = {
  id: "naming-drift",
  name: "Naming drift",
  description: "Finds files where similar concepts are represented by many competing names.",
  defaultSeverity: "info",
  tags: ["naming", "architecture", "domain-modeling"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const minVariants = context.getThreshold("naming-drift.minVariants", 4);
    const conceptGroups = resolveConceptGroups(context.options.vocabulary);

    for (const file of context.files) {
      const identifiers = file.sourceFile
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .flatMap((identifier) => splitIdentifier(identifier.getText()));
      const tokenSet = new Set(identifiers);

      for (const group of conceptGroups) {
        const found = group.variants.filter((variant) => tokenSet.has(variant));
        if (found.length < minVariants) continue;

        issues.push(createIssue({
          detector: namingDriftDetector,
          severity: found.length >= minVariants + 2 ? "low" : "info",
          confidence: 0.62,
          file: file.relativePath,
          location: { startLine: 1 },
          message: `This file uses ${found.length} competing terms for ${group.label}: ${found.join(", ")}.`,
          evidence: [`Concept group: ${group.id}`, `Variants found: ${found.join(", ")}`],
          suggestion: "Pick a canonical domain name and rename adapters at system boundaries instead of mixing boundary names throughout the feature.",
        }));
      }
    }

    return issues;
  },
};
