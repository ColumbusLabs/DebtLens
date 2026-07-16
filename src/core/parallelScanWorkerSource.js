// Source-only worker bootstrap for tests and `tsx` development commands.
// Released builds resolve parallelScanWorker.js instead and do not depend on tsx.
import { workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";

await register();
await import(workerData.sourceWorkerUrl);
