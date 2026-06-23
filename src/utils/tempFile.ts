import { unlinkSync } from "node:fs";

export function cleanupTempFile(tempPath: string, context: string): void {
  try {
    unlinkSync(tempPath);
  } catch (error) {
    if (process.env.DEBTLENS_DEBUG) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`DebtLens could not remove temporary ${context} file ${tempPath}: ${message}`);
    }
  }
}
