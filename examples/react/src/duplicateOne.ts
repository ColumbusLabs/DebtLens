export function normalizeMovieRelease(item: any) {
  const title = String(item.title || item.name || "").trim();
  const date = item.releaseDate || item.airDate || item.launchDate || null;
  const region = item.region || "US";
  const kind = item.kind || "movie";

  if (!title || !date) {
    return null;
  }

  return {
    id: `${kind}:${item.id}`,
    title,
    date,
    region,
    kind,
  };
}
