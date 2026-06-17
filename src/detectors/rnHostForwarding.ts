import { Node, SyntaxKind } from "ts-morph";
import type { Node as MorphNode, SourceFile } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { collectFunctionLikes, getFunctionBody } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

const RN_HOST_COMPONENTS = new Set([
  "View",
  "Text",
  "Pressable",
  "FlatList",
  "SectionList",
  "VirtualizedList",
  "TextInput",
  "Image",
  "ImageBackground",
  "ScrollView",
  "SafeAreaView",
  "KeyboardAvoidingView",
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "TouchableNativeFeedback",
  "Switch",
  "Modal",
  "ActivityIndicator",
  "Button",
  "RefreshControl",
  "StatusBar",
]);

const RN_MODULES = new Set([
  "react-native",
  "react-native-safe-area-context",
]);

interface ReactNativeImports {
  hostLocals: Set<string>;
  namespaces: Set<string>;
}

interface PropSources {
  directNames: Set<string>;
  propObjectNames: Set<string>;
  restNames: Set<string>;
}

interface ForwardedHostProp {
  attrName: string;
  label: string;
  kind: "prop" | "style" | "handler" | "spread";
}

export const rnHostForwardingDetector: Detector = {
  id: "rn-host-forwarding",
  name: "React Native host forwarding",
  description: "Flags React Native components that mostly pass wrapper props into host primitives.",
  defaultSeverity: "medium",
  tags: ["react-native", "props", "component-design"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxForwardedProps = context.getThreshold("rn-host-forwarding.maxForwardedProps", 6);
    const maxHostTargets = context.getThreshold("rn-host-forwarding.maxHostTargets", 3);

    for (const file of context.files) {
      const rnImports = collectReactNativeImports(file.sourceFile);
      if (rnImports.hostLocals.size === 0 && rnImports.namespaces.size === 0) continue;

      for (const fn of collectFunctionLikes(file)) {
        if (fn.classification !== "component") continue;

        const propSources = inferPropSources(fn.node);
        if (!hasPropSources(propSources)) continue;

        const body = getFunctionBody(fn.node) ?? fn.node;
        const forwardedByHost = new Map<string, ForwardedHostProp[]>();

        const jsxNodes = [
          ...body.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
          ...body.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
        ];

        for (const jsx of jsxNodes) {
          const tagName = jsx.getTagNameNode().getText();
          if (!isReactNativeHostTag(tagName, rnImports)) continue;

          const forwarded = collectForwardedHostProps(jsx.getAttributes(), propSources);
          if (forwarded.length > 0) {
            const existing = forwardedByHost.get(tagName) ?? [];
            forwardedByHost.set(tagName, [...existing, ...forwarded]);
          }
        }

        if (forwardedByHost.size === 0) continue;

        const uniqueForwarded = new Set(
          [...forwardedByHost.values()].flatMap((props) => props.map((prop) => prop.label)),
        );
        const forwardedCount = [...forwardedByHost.values()].reduce((total, props) => total + props.length, 0);
        const broadSpreadCount = [...forwardedByHost.values()].flat().filter((prop) => prop.kind === "spread").length;
        const fanoutHostSignal = forwardedByHost.size >= maxHostTargets && forwardedCount >= maxForwardedProps;
        if (uniqueForwarded.size < maxForwardedProps && !fanoutHostSignal && broadSpreadCount === 0) continue;

        const span = nodeLineSpan(body);
        const styleCount = [...forwardedByHost.values()].flat().filter((prop) => prop.kind === "style").length;
        const handlerCount = [...forwardedByHost.values()].flat().filter((prop) => prop.kind === "handler").length;

        issues.push(createIssue({
          detector: rnHostForwardingDetector,
          severity: uniqueForwarded.size >= maxForwardedProps + 3 || broadSpreadCount > 0 ? "high" : "medium",
          confidence: broadSpreadCount > 0 ? 0.84 : 0.78,
          file: file.relativePath,
          location: { startLine: span.startLine, endLine: span.endLine },
          message: `${fn.name} forwards ${uniqueForwarded.size} wrapper props into ${forwardedByHost.size} React Native host primitives.`,
          evidence: [
            ...[...forwardedByHost.entries()]
              .slice(0, 5)
              .map(([host, props]) => `${host}: ${props.map((prop) => prop.label).join(", ")}`),
            `Style props: ${styleCount}`,
            `Handler props: ${handlerCount}`,
          ],
          suggestion: "Consider narrowing the wrapper API, splitting visual variants from host passthrough props, or moving the host primitive ownership to callers.",
        }));
      }
    }

    return issues;
  },
};

function collectReactNativeImports(sourceFile: SourceFile): ReactNativeImports {
  const hostLocals = new Set<string>();
  const namespaces = new Set<string>();

  for (const declaration of sourceFile.getImportDeclarations()) {
    const moduleName = declaration.getModuleSpecifierValue();
    if (!RN_MODULES.has(moduleName)) continue;

    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport) {
      namespaces.add(namespaceImport.getText());
    }

    for (const specifier of declaration.getNamedImports()) {
      const importedName = specifier.getName();
      if (!RN_HOST_COMPONENTS.has(importedName)) continue;
      hostLocals.add(specifier.getAliasNode()?.getText() ?? importedName);
    }
  }

  return { hostLocals, namespaces };
}

function isReactNativeHostTag(tagName: string, imports: ReactNativeImports): boolean {
  if (imports.hostLocals.has(tagName)) return true;

  const parts = tagName.split(".");
  if (parts.length < 2) return false;

  const root = parts[0];
  const base = parts.at(-1);
  return Boolean(
    base
    && RN_HOST_COMPONENTS.has(base)
    && (imports.namespaces.has(root) || imports.hostLocals.has(root)),
  );
}

function inferPropSources(node: { getParameters: () => { getText: () => string }[] }): PropSources {
  const directNames = new Set<string>();
  const propObjectNames = new Set<string>();
  const restNames = new Set<string>();
  const [firstParam] = node.getParameters();
  if (!firstParam) return { directNames, propObjectNames, restNames };

  const text = firstParam.getText();
  const objectPattern = text.match(/^\s*\{([\s\S]*)\}\s*(?::|=|$)/);
  if (objectPattern?.[1]) {
    for (const part of objectPattern[1].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("...")) {
        const restName = trimmed.slice(3).trim().match(/^([A-Za-z_$][\w$]*)/)?.[1];
        if (restName) {
          restNames.add(restName);
          propObjectNames.add(restName);
        }
        continue;
      }

      const withoutDefault = trimmed.split("=")[0]?.trim() ?? "";
      const localName = withoutDefault.match(/(?:[A-Za-z_$][\w$]*\s*:\s*)?([A-Za-z_$][\w$]*)$/)?.[1];
      if (localName) {
        directNames.add(localName);
      }
    }

    return { directNames, propObjectNames, restNames };
  }

  const paramName = text.match(/^\s*([A-Za-z_$][\w$]*)/)?.[1];
  if (paramName) {
    propObjectNames.add(paramName);
  }

  return { directNames, propObjectNames, restNames };
}

function collectForwardedHostProps(attributes: MorphNode[], propSources: PropSources): ForwardedHostProp[] {
  const forwarded: ForwardedHostProp[] = [];

  for (const attribute of attributes) {
    if (Node.isJsxSpreadAttribute(attribute)) {
      const expression = attribute.getExpression().getText();
      if (propSources.propObjectNames.has(expression) || propSources.restNames.has(expression)) {
        forwarded.push({ attrName: "...", label: `...${expression}`, kind: "spread" });
      }
      continue;
    }

    if (!Node.isJsxAttribute(attribute)) continue;

    const attrName = attribute.getNameNode().getText();
    const initializer = attribute.getInitializer()?.getText() ?? "";
    if (!initializer) continue;

    const labels = new Set<string>();
    for (const propName of propSources.directNames) {
      if (new RegExp(`\\b${escapeRegExp(propName)}\\b`).test(initializer)) {
        labels.add(propName);
      }
    }

    for (const objectName of propSources.propObjectNames) {
      const memberPattern = new RegExp(`\\b${escapeRegExp(objectName)}\\.([A-Za-z_$][\\w$]*)`, "g");
      for (const match of initializer.matchAll(memberPattern)) {
        if (match[1]) {
          labels.add(match[1]);
        }
      }
    }

    for (const label of labels) {
      forwarded.push({ attrName, label, kind: classifyForwardedProp(attrName, label) });
    }
  }

  return forwarded;
}

function classifyForwardedProp(attrName: string, label: string): ForwardedHostProp["kind"] {
  if (/style/i.test(attrName) || /style/i.test(label)) return "style";
  if (/^on[A-Z]/.test(attrName) || /^on[A-Z]/.test(label)) return "handler";
  return "prop";
}

function hasPropSources(propSources: PropSources): boolean {
  return propSources.directNames.size > 0
    || propSources.propObjectNames.size > 0
    || propSources.restNames.size > 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
