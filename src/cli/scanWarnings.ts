export function buildZeroFilesScannedWarning(target: string, include: string[], usedGitFileFilter: boolean): string {
  const hints = [
    "check your include/exclude globs",
    "verify the target path or --cwd",
  ];

  if (usedGitFileFilter) {
    hints.push("confirm the git file filter resolves to tracked files");
  }

  return [
    "DebtLens warning: scanned 0 files.",
    `Target: ${target}`,
    `Include globs: ${include.join(", ")}`,
    `Likely causes: ${hints.join("; ")}.`,
    "",
  ].join("\n");
}
