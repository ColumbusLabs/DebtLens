export interface ReleaseEnvelope {
  movieId: string;
  releaseDate: string;
  apiProvider: "internal" | "partner";
}

export function toReleaseEnvelope(movieId: string, releaseDate: string, apiProvider: ReleaseEnvelope["apiProvider"]): ReleaseEnvelope {
  return {
    movieId,
    releaseDate,
    apiProvider,
  };
}
