export function parseCommaList(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const parsed = values
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

export function parseThresholds(value: string | undefined): Record<string, number> | undefined {
  if (!value) return undefined;
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  const result: Record<string, number> = {};

  for (const entry of entries) {
    const [key, rawValue] = entry.split("=").map((part) => part.trim());
    if (!key || !rawValue) {
      throw new Error(`Invalid threshold "${entry}". Use key=value, for example large-component.maxLines=300.`);
    }
    const numberValue = Number(rawValue);
    if (!Number.isFinite(numberValue)) {
      throw new Error(`Invalid numeric threshold value in "${entry}".`);
    }
    result[key] = numberValue;
  }

  return result;
}
