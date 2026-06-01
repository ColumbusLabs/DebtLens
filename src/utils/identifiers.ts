const stopWords = new Set([
  "get", "set", "use", "is", "has", "with", "from", "to", "by", "for", "and", "or", "the", "a", "an",
  "component", "props", "state", "data", "item", "items", "value", "values", "result", "results"
]);

export function splitIdentifier(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2 && !stopWords.has(part));
}

export function isPascalCase(value: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(value);
}

export function isHookName(value: string): boolean {
  return /^use[A-Z0-9]/.test(value);
}
