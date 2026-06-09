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

/** Walk upward from cwd to find a package.json with a workspaces field. */
export function findWorkspaceRoot(cwd: string): string | undefined {
  let current = resolve(cwd);
  while (true) {
    const packageJsonPath = resolve(current, "package.json");
    if (existsSync(packageJsonPath)) {
      const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
      if (normalizeWorkspacePatterns(parsed.workspaces).length > 0) {
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

export function listWorkspacePackages(workspaceRoot: string): WorkspacePackage[] {
  const packageJsonPath = resolve(workspaceRoot, "package.json");
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
  const patterns = normalizeWorkspacePatterns(parsed.workspaces);
  const packages: WorkspacePackage[] = [];

  for (const pattern of patterns) {
    if (!pattern.endsWith("/*")) {
      continue;
    }
    const directories = fg.sync(pattern, {
      cwd: workspaceRoot,
      onlyDirectories: true,
      absolute: true,
    });
    for (const directory of directories) {
      const childPath = resolve(directory, "package.json");
      if (!existsSync(childPath)) continue;
      const child = JSON.parse(readFileSync(childPath, "utf8")) as PackageJson;
      if (!child.name) continue;
      packages.push({ name: child.name, directory });
    }
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
