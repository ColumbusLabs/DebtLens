import { readFileSync } from "node:fs";

interface PackageJson {
  version?: string;
}

export const packageVersion = readPackageVersion();

function readPackageVersion(): string {
  const candidates = [
    new URL("../package.json", import.meta.url),
    new URL("../../package.json", import.meta.url),
  ];
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as PackageJson;
      if (parsed.version) return parsed.version;
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Could not read package.json version: ${message}`);
}
