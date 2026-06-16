import { Node, SyntaxKind } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { collectFunctionLikes, getFunctionBody } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

export const contextProviderSprawlDetector: Detector = {
  id: "context-provider-sprawl",
  name: "Context provider sprawl",
  description: "Flags components that wrap children in many unrelated React context providers.",
  defaultSeverity: "medium",
  tags: ["react", "context", "component-design"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxProviders = context.getThreshold("context-provider-sprawl.maxProviders", 4);

    for (const file of context.files) {
      for (const fn of collectFunctionLikes(file)) {
        if (fn.classification !== "component") continue;
        const body = getFunctionBody(fn.node);
        if (!body) continue;

        const providers = new Map<string, string>();
        const jsxNodes = [
          ...body.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
          ...body.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
        ];

        for (const jsx of jsxNodes) {
          const tagName = jsx.getTagNameNode().getText();
          const contextName = getContextProviderName(tagName);
          if (!contextName) continue;

          const valueAttribute = jsx.getAttributes().find((attribute) =>
            Node.isJsxAttribute(attribute) && attribute.getNameNode().getText() === "value",
          );
          providers.set(contextName, valueAttribute?.getText().replace(/\s+/g, " ") ?? `${tagName} without value`);
        }

        if (providers.size < maxProviders) continue;

        const span = nodeLineSpan(body);
        issues.push(createIssue({
          detector: contextProviderSprawlDetector,
          severity: providers.size >= maxProviders + 3 ? "high" : "medium",
          confidence: 0.74,
          file: file.relativePath,
          location: { startLine: span.startLine, endLine: span.endLine },
          message: `${fn.name} wraps children in ${providers.size} distinct Context.Provider values.`,
          evidence: [...providers.entries()].slice(0, 6).map(([name, value]) => `${name}: ${value}`),
          suggestion: "Check whether these providers describe one cohesive boundary. If not, split the provider shell or colocate context closer to the consumers.",
        }));
      }
    }

    return issues;
  },
};

function getContextProviderName(tagName: string): string | undefined {
  const match = tagName.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.Provider$/);
  return match?.[1];
}
