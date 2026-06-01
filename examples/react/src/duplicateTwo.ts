export function normalizeGameRelease(record: any) {
  const title = String(record.title || record.name || "").trim();
  const date = record.releaseDate || record.airDate || record.launchDate || null;
  const region = record.region || "US";
  const kind = record.kind || "game";

  if (!title || !date) {
    return null;
  }

  return {
    id: `${kind}:${record.id}`,
    title,
    date,
    region,
    kind,
  };
}
