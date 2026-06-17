import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import fg from "fast-glob";

export interface WorkspacePackage {
  name: string;
  directory: string;
}

interface PackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
}

interface NxJson {
  workspaceLayout?: {
    appsDir?: string;
    libsDir?: string;
  };
  projects?: Record<string, string | { root?: string }>;
}

/** Walk upward from cwd to find package.json, pnpm, or Nx workspace hints. */
export function findWorkspaceRoot(cwd: string): string | undefined {
  let current = resolve(cwd);
  while (true) {
    if (resolveWorkspacePatterns(current).length > 0) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

export function listWorkspacePackages(workspaceRoot: string): WorkspacePackage[] {
  const patterns = resolveWorkspacePatterns(workspaceRoot);
  const packages: WorkspacePackage[] = [];
  const seenDirectories = new Set<string>();

  const directories = fg.sync(patterns, {
    cwd: workspaceRoot,
    onlyDirectories: true,
    absolute: true,
    ignore: ["**/node_modules/**"],
    unique: true,
  });
  for (const directory of directories) {
    const childPath = resolve(directory, "package.json");
    if (!existsSync(childPath)) continue;
    const child = JSON.parse(readFileSync(childPath, "utf8")) as PackageJson;
    if (!child.name || seenDirectories.has(directory)) continue;
    seenDirectories.add(directory);
    packages.push({ name: child.name, directory });
  }

  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

export function resolveWorkspacePackage(
  cwd: string,
  packageName: string,
): { workspaceRoot: string; directory: string } {
  const workspaceRoot = findWorkspaceRoot(cwd);
  if (!workspaceRoot) {
    throw new Error("No npm/yarn/pnpm workspace found from the current directory.");
  }

  const packages = listWorkspacePackages(workspaceRoot);
  const match = packages.find((pkg) => pkg.name === packageName);
  if (!match) {
    const available = packages.map((pkg) => pkg.name).join(", ");
    throw new Error(`Workspace package "${packageName}" not found.${available ? ` Available: ${available}` : ""}`);
  }

  return { workspaceRoot, directory: match.directory };
}

function normalizeWorkspacePatterns(workspaces: PackageJson["workspaces"]): string[] {
  if (!workspaces) return [];
  if (Array.isArray(workspaces)) return workspaces;
  return workspaces.packages ?? [];
}

function resolveWorkspacePatterns(workspaceRoot: string): string[] {
  return dedupePatterns([
    ...readPackageWorkspacePatterns(workspaceRoot),
    ...readPnpmWorkspacePatterns(workspaceRoot),
    ...readNxWorkspacePatterns(workspaceRoot),
  ]);
}

function readPackageWorkspacePatterns(workspaceRoot: string): string[] {
  const packageJsonPath = resolve(workspaceRoot, "package.json");
  if (!existsSync(packageJsonPath)) return [];
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
  return normalizeWorkspacePatterns(parsed.workspaces);
}

function readPnpmWorkspacePatterns(workspaceRoot: string): string[] {
  const workspacePath = resolve(workspaceRoot, "pnpm-workspace.yaml");
  if (!existsSync(workspacePath)) return [];

  const patterns: string[] = [];
  let inPackages = false;
  for (const rawLine of readFileSync(workspacePath, "utf8").split("\n")) {
    const withoutComment = rawLine.replace(/\s+#.*$/, "");
    const trimmed = withoutComment.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("packages:")) {
      inPackages = true;
      const inline = trimmed.match(/^packages:\s*\[(.*)\]\s*$/);
      if (inline) {
        patterns.push(...inline[1].split(",").map((entry) => unquote(entry.trim())).filter(Boolean));
      }
      continue;
    }

    if (!inPackages) continue;
    if (!rawLine.startsWith(" ") && !rawLine.startsWith("\t")) break;
    if (trimmed.startsWith("- ")) {
      const pattern = unquote(trimmed.slice(2).trim());
      if (pattern) patterns.push(pattern);
    }
  }
  return patterns;
}

function readNxWorkspacePatterns(workspaceRoot: string): string[] {
  const nxPath = resolve(workspaceRoot, "nx.json");
  if (!existsSync(nxPath)) return [];

  const parsed = JSON.parse(readFileSync(nxPath, "utf8")) as NxJson;
  const layout = parsed.workspaceLayout ?? {};
  const patterns = [
    `${layout.appsDir ?? "apps"}/*`,
    `${layout.libsDir ?? "libs"}/*`,
    "packages/*",
  ];

  for (const project of Object.values(parsed.projects ?? {})) {
    const root = typeof project === "string" ? project : project.root;
    if (root) patterns.push(root);
  }

  return patterns;
}

function dedupePatterns(patterns: string[]): string[] {
  const seen = new Set<string>();
  return patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .filter((pattern) => {
      if (seen.has(pattern)) return false;
      seen.add(pattern);
      return true;
    });
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}
