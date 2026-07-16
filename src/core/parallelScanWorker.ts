import { basename, relative } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { Project, ScriptTarget, ts } from "ts-morph";
import { allDetectors } from "../detectors/index.js";
import { detectSourceLanguage, languagesForDetector, parseSourceFile } from "./languages.js";
import type { WorkerDetectorResult } from "./parallelScan.js";
import type { FileSnapshot } from "./scanCache.js";
import type { DetectorContext, ScanOptions, SourceFileInfo } from "./types.js";

interface ParallelWorkerData {
  detectorIds: string[];
  snapshots: FileSnapshot[];
  options: ScanOptions;
}

async function main(): Promise<void> {
  const data = workerData as ParallelWorkerData;
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.ReactJSX,
      target: ScriptTarget.ES2022,
      skipLibCheck: true,
    },
    skipAddingFilesFromTsConfig: true,
  });
  const files = loadSourceFiles(project, data.snapshots, data.options);
  const detectorsById = new Map(allDetectors.map((detector) => [detector.id, detector]));
  const results: WorkerDetectorResult[] = [];

  for (const detectorId of data.detectorIds) {
    const detector = detectorsById.get(detectorId);
    if (!detector) throw new Error(`Unknown built-in detector "${detectorId}" in parallel worker.`);
    const warnings: string[] = [];
    const startedAt = data.options.profile ? Date.now() : 0;
    const allowedLanguages = new Set(languagesForDetector(detector));
    const context: DetectorContext = {
      project,
      files: files.filter((file) => allowedLanguages.has(file.language)),
      options: data.options,
      getThreshold: (key, fallback) => data.options.thresholds[key] ?? fallback,
      addWarning: (warning) => {
        if (!warnings.includes(warning)) warnings.push(warning);
      },
    };
    const issues = await detector.detect(context);
    results.push({
      detectorId,
      issues,
      elapsedMs: data.options.profile ? Date.now() - startedAt : 0,
      warnings,
    });
  }

  parentPort?.postMessage({ ok: true, results });
}

function loadSourceFiles(project: Project, snapshots: FileSnapshot[], options: ScanOptions): SourceFileInfo[] {
  return snapshots.map((snapshot) => {
    const relativePath = snapshot.absolutePath === options.target
      ? basename(snapshot.absolutePath)
      : relative(options.target, snapshot.absolutePath).replaceAll("\\", "/");
    return parseSourceFile({
      project,
      absolutePath: snapshot.absolutePath,
      relativePath,
      content: snapshot.content,
      language: detectSourceLanguage(snapshot.absolutePath),
    });
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  parentPort?.postMessage({ ok: false, error: message });
});
