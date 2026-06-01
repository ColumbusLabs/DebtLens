import { Node, SyntaxKind } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { collectFunctionLikes, getFunctionBody } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { isHostComponent } from "../utils/hostComponents.js";
import { nodeLineSpan } from "../utils/lines.js";

export const propDrillingDetector: Detector = {
  id: "prop-drilling",
  name: "Prop drilling",
  description: "Flags components that mostly forward props to child components.",
  defaultSeverity: "medium",
  tags: ["react", "props", "component-design"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxForwardedProps = context.getThreshold("prop-drilling.maxForwardedProps", 4);

    for (const file of context.files) {
      for (const fn of collectFunctionLikes(file)) {
        if (fn.classification !== "component") continue;
        const propNames = inferPropNames(fn.node);
        if (propNames.size === 0) continue;

        const body = getFunctionBody(fn.node) ?? fn.node;
        const forwarded = new Map<string, Set<string>>();

        const jsxNodes = [
          ...body.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
          ...body.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
        ];

        for (const jsx of jsxNodes) {
          const tagName = jsx.getTagNameNode().getText();
          // Skip host elements (lowercase DOM tags) and UI primitives (RN/icon
          // components are PascalCase but aren't user-defined children).
          if (/^[a-z]/.test(tagName) || isHostComponent(tagName)) continue;
          const childForwarded = new Set<string>();
          for (const attribute of jsx.getAttributes()) {
            if (!Node.isJsxAttribute(attribute)) continue;
            const initializer = attribute.getInitializer()?.getText() ?? "";
            for (const propName of propNames) {
              if (new RegExp(`\\b${escapeRegExp(propName)}\\b`).test(initializer)) {
                childForwarded.add(propName);
              }
            }
          }
          if (childForwarded.size > 0) {
            forwarded.set(tagName, childForwarded);
          }
        }

        const uniqueForwarded = new Set([...forwarded.values()].flatMap((value) => [...value]));
        if (uniqueForwarded.size < maxForwardedProps && forwarded.size < 3) continue;

        const span = nodeLineSpan(body);
        issues.push(createIssue({
          detector: propDrillingDetector,
          severity: uniqueForwarded.size >= maxForwardedProps + 3 ? "high" : "medium",
          confidence: 0.73,
          file: file.relativePath,
          location: { startLine: span.startLine, endLine: span.endLine },
          message: `${fn.name} forwards ${uniqueForwarded.size} props across ${forwarded.size} child components.`,
          evidence: [...forwarded.entries()].slice(0, 5).map(([child, props]) => `${child}: ${[...props].join(", ")}`),
          suggestion: "Consider colocating the data owner closer to consumers, using a composition slot, or extracting a focused context for stable cross-cutting values.",
        }));
      }
    }

    return issues;
  },
};

function inferPropNames(node: { getParameters: () => { getText: () => string; getName?: () => string }[] }): Set<string> {
  const names = new Set<string>();
  const [firstParam] = node.getParameters();
  if (!firstParam) return names;
  const text = firstParam.getText();

  if (text.startsWith("{")) {
    const withoutType = text.split(":").slice(0, -1).join(":") || text;
    for (const match of withoutType.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      const name = match[1];
      if (name && !["readonly", "string", "number", "boolean", "React", "Props"].includes(name)) {
        names.add(name);
      }
    }
    return names;
  }

  const paramName = text.split(/[\s:=>,]/)[0];
  if (!paramName) return names;
  if (paramName === "props") {
    names.add("props");
    return names;
  }

  names.add(paramName);
  return names;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
