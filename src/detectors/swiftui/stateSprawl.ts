import type { DebtIssue, Detector, DetectorContext } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractSwiftViewStructs } from "../swift/parse.js";
import { collectSwiftUIStateHolders, countHoistedSwiftUIStateSignals, isPreviewView, isSwiftUIView } from "./parse.js";

export const swiftuiStateSprawlDetector: Detector = {
  id: "swiftui-state-sprawl",
  name: "SwiftUI state sprawl",
  description: "Flags SwiftUI views that own many local property-wrapper state holders instead of accepting state and events from callers.",
  defaultSeverity: "medium",
  tags: ["swiftui", "swift", "state", "component-design"],
  languages: ["swift"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxStateHolders = context.getThreshold("swiftui-state-sprawl.maxStateHolders", 4);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      for (const view of extractSwiftViewStructs(file)) {
        if (!isSwiftUIView(view) || isPreviewView(view, file.content, view.startLine)) continue;
        const holders = collectSwiftUIStateHolders(view);
        if (holders.length <= maxStateHolders) continue;

        const hoistedSignals = countHoistedSwiftUIStateSignals(view);
        const holderNames = holders.map((holder) => holder.name).filter(Boolean);
        issues.push(createIssue({
          detector: swiftuiStateSprawlDetector,
          severity: holders.length >= maxStateHolders + 4 ? "high" : "medium",
          confidence: hoistedSignals > 0 ? 0.78 : 0.84,
          file: file.relativePath,
          location: { startLine: view.startLine, endLine: view.endLine },
          message: `${view.name} owns ${holders.length} local SwiftUI state holders. This usually means screen state has not been hoisted.`,
          evidence: [
            `Local state: ${holderNames.length ? holderNames.slice(0, 8).join(", ") : `${holders.length} declarations`}`,
            ...(hoistedSignals > 0 ? [`Hoisted state/event parameters already present: ${hoistedSignals}`] : []),
            ...holders.slice(0, 3).map((holder) => holder.line),
          ],
          suggestion: "Move durable screen state to a parent view, observable model, or coordinator and pass state plus event callbacks into the view.",
        }));
      }
    }

    return issues;
  },
};
