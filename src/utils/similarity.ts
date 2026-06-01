export function normalizeSnippet(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "__str__")
    .replace(/\b\d+(?:\.\d+)?\b/g, "__num__")
    .replace(/\b[A-Za-z_$][\w$]*\b/g, (token) => keywordSet.has(token) ? token : "__id__")
    .replace(/\s+/g, " ")
    .trim();
}

export function shingle(value: string, size = 5): Set<string> {
  const tokens = value.split(/\s+/).filter(Boolean);
  const shingles = new Set<string>();
  for (let i = 0; i <= tokens.length - size; i += 1) {
    shingles.add(tokens.slice(i, i + size).join(" "));
  }
  if (shingles.size === 0 && tokens.length > 0) {
    shingles.add(tokens.join(" "));
  }
  return shingles;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Cosine similarity between two token-count vectors (multisets). Used to compare the
 * structural fingerprints of two functions before the more expensive text-shingle step.
 */
export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [key, value] of a) {
    normA += value * value;
    const other = b.get(key);
    if (other) dot += value * other;
  }
  for (const value of b.values()) {
    normB += value * value;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

const keywordSet = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "return", "const", "let", "var",
  "function", "class", "extends", "implements", "interface", "type", "import", "export", "default", "from", "async",
  "await", "try", "catch", "finally", "throw", "new", "this", "super", "true", "false", "null", "undefined",
  "useState", "useEffect", "useMemo", "useCallback", "useReducer", "useRef"
]);
