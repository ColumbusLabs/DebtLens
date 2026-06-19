import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractKotlinFunctions } from "../kotlin/parse.js";
import { collectComposeStateHolders, countHoistedComposeStateSignals, isComposableFunction, isPreviewComposable } from "./parse.js";

export const composeStateHoistingDetector: Detector = {
  id: "compose-state-hoisting",
  name: "Compose state hoisting smell",
  description: "Flags composables that own many local Compose state holders instead of accepting state and events from callers.",
  defaultSeverity: "medium",
  tags: ["compose", "kotlin", "state", "component-design"],
  languages: ["kotlin"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxLocalState = context.getThreshold("compose-state-hoisting.maxLocalState", 4);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      for (const fn of extractKotlinFunctions(file)) {
        if (!isComposableFunction(fn) || isPreviewComposable(fn)) continue;
        const holders = collectComposeStateHolders(fn);
        if (holders.length <= maxLocalState) continue;

        const hoistedSignals = countHoistedComposeStateSignals(fn);
        const holderNames = holders.map((holder) => holder.name).filter(Boolean);
        issues.push(createIssue({
          detector: composeStateHoistingDetector,
          severity: holders.length >= maxLocalState + 4 ? "high" : "medium",
          confidence: hoistedSignals > 0 ? 0.78 : 0.84,
          file: file.relativePath,
          location: { startLine: fn.startLine, endLine: fn.endLine },
          message: `${fn.name} owns ${holders.length} local Compose state holders. This usually means screen state has not been hoisted.`,
          evidence: [
            `Local state: ${holderNames.length ? holderNames.slice(0, 8).join(", ") : `${holders.length} declarations`}`,
            ...(hoistedSignals > 0 ? [`Hoisted state/event parameters already present: ${hoistedSignals}`] : []),
            ...holders.slice(0, 3).map((holder) => holder.line),
          ],
          suggestion: "Move durable screen state to a caller, ViewModel, or state holder and pass state plus event callbacks into the composable.",
        }));
      }
    }

    return issues;
  },
};
