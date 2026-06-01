import { Node, SyntaxKind } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { collectFunctionLikes, getFunctionBody } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

const statefulHooks = new Set(["useState", "useReducer", "useRef", "useSyncExternalStore", "useTransition", "useOptimistic"]);

export const stateSprawlDetector: Detector = {
  id: "state-sprawl",
  name: "State sprawl",
  description: "Flags components/hooks that manage many independent pieces of local state.",
  defaultSeverity: "medium",
  tags: ["react", "state", "complexity"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxStatefulHooks = context.getThreshold("state-sprawl.maxStatefulHooks", 6);

    for (const file of context.files) {
      for (const fn of collectFunctionLikes(file)) {
        if (fn.classification === "function") continue;
        const body = getFunctionBody(fn.node) ?? fn.node;
        const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
          const expression = call.getExpression();
          if (Node.isIdentifier(expression)) return statefulHooks.has(expression.getText());
          if (Node.isPropertyAccessExpression(expression)) return statefulHooks.has(expression.getName());
          return false;
        });

        if (calls.length < maxStatefulHooks) continue;

        const span = nodeLineSpan(body);
        const names = calls.map((call) => call.getExpression().getText());
        issues.push(createIssue({
          detector: stateSprawlDetector,
          severity: calls.length >= maxStatefulHooks + 4 ? "high" : "medium",
          confidence: 0.82,
          file: file.relativePath,
          location: { startLine: span.startLine, endLine: span.endLine },
          message: `${fn.name} manages ${calls.length} stateful hook calls. This often means one component is coordinating several unrelated workflows.`,
          evidence: [`Stateful hooks: ${names.join(", ")}`],
          suggestion: "Group related state in a reducer, extract state machines into a hook, or move server/cache state out of component state.",
        }));
      }
    }

    return issues;
  },
};
