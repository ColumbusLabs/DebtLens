import { Node, SyntaxKind } from "ts-morph";
import type {
  ArrowFunction,
  CallExpression,
  ClassDeclaration,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  Node as MorphNode,
  SourceFile,
  VariableDeclaration,
} from "ts-morph";
import type { SourceFileInfo } from "../core/types.js";
import { isHookName, isPascalCase } from "./identifiers.js";

export type FunctionNode = FunctionDeclaration | ArrowFunction | FunctionExpression;

export interface FunctionLikeInfo {
  name: string;
  node: FunctionNode;
  declaration: FunctionDeclaration | VariableDeclaration;
  file: SourceFileInfo;
  classification: "component" | "hook" | "function";
  kind: "function";
}

export interface ClassComponentInfo {
  name: string;
  node: ClassDeclaration;
  declaration: ClassDeclaration;
  file: SourceFileInfo;
  classification: "component";
  kind: "class";
}

export type ComponentLikeInfo = FunctionLikeInfo | ClassComponentInfo;

const REACT_WRAPPER_NAMES = new Set(["memo", "forwardRef"]);

export function collectFunctionLikes(file: SourceFileInfo): FunctionLikeInfo[] {
  const results: FunctionLikeInfo[] = [];

  for (const declaration of file.sourceFile.getFunctions()) {
    const name = declaration.getName();
    if (!name) continue;
    results.push({
      name,
      node: declaration,
      declaration,
      file,
      classification: classifyFunctionName(name),
      kind: "function",
    });
  }

  for (const declaration of file.sourceFile.getVariableDeclarations()) {
    const name = declaration.getName();
    const initializer = declaration.getInitializer();
    if (!initializer) continue;

    const unwrapped = unwrapReactWrapper(initializer);
    const functionNode = unwrapped ?? (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)
      ? initializer
      : undefined);

    if (!functionNode) continue;

    results.push({
      name,
      node: functionNode,
      declaration,
      file,
      classification: classifyFunctionName(name),
      kind: "function",
    });
  }

  return results;
}

export function collectClassComponents(file: SourceFileInfo): ClassComponentInfo[] {
  const results: ClassComponentInfo[] = [];

  for (const declaration of file.sourceFile.getClasses()) {
    const name = declaration.getName();
    if (!name || !isPascalCase(name) || !isReactClassComponent(declaration)) continue;

    results.push({
      name,
      node: declaration,
      declaration,
      file,
      classification: "component",
      kind: "class",
    });
  }

  return results;
}

export function collectComponentLikes(file: SourceFileInfo): ComponentLikeInfo[] {
  return [...collectFunctionLikes(file), ...collectClassComponents(file)];
}

function unwrapReactWrapper(initializer: Expression): FunctionNode | undefined {
  if (!Node.isCallExpression(initializer)) return undefined;

  const calleeText = initializer.getExpression().getText();
  const calleeName = calleeText.includes(".") ? calleeText.split(".").pop() : calleeText;
  if (!calleeName || !REACT_WRAPPER_NAMES.has(calleeName)) return undefined;

  for (const argument of initializer.getArguments()) {
    if (Node.isArrowFunction(argument) || Node.isFunctionExpression(argument)) {
      return argument;
    }
  }

  return undefined;
}

function isReactClassComponent(declaration: ClassDeclaration): boolean {
  const heritage = declaration.getExtends()?.getText() ?? "";
  return /(?:^|\.)Component$/.test(heritage)
    || /(?:^|\.)PureComponent$/.test(heritage)
    || heritage === "React.Component"
    || heritage === "React.PureComponent";
}

export function classifyFunctionName(name: string): FunctionLikeInfo["classification"] {
  if (isHookName(name)) return "hook";
  if (isPascalCase(name)) return "component";
  return "function";
}

export function getFunctionBody(node: FunctionNode): MorphNode | undefined {
  if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node) || Node.isArrowFunction(node)) {
    return node.getBody();
  }
  return undefined;
}

export function getComponentBody(component: ComponentLikeInfo): MorphNode {
  if (component.kind === "class") {
    return component.node;
  }

  return getFunctionBody(component.node) ?? component.node;
}

export function countHookCalls(node: MorphNode): number {
  return node.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    const expression = call.getExpression();
    return Node.isIdentifier(expression) && isHookName(expression.getText());
  }).length;
}

export function countBranches(node: MorphNode): number {
  return node.getDescendants().filter((descendant) => {
    const kind = descendant.getKind();
    return kind === SyntaxKind.IfStatement
      || kind === SyntaxKind.ConditionalExpression
      || kind === SyntaxKind.SwitchStatement
      || kind === SyntaxKind.ForStatement
      || kind === SyntaxKind.ForOfStatement
      || kind === SyntaxKind.ForInStatement
      || kind === SyntaxKind.WhileStatement
      || kind === SyntaxKind.DoStatement
      || kind === SyntaxKind.CatchClause;
  }).length;
}

export function getCallName(callExpressionText: string): string | undefined {
  const match = callExpressionText.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  return match?.[1];
}

export function getSourceFileLine(sourceFile: SourceFile, lineNumber: number): string {
  return sourceFile.getFullText().split(/\r?\n/)[lineNumber - 1] ?? "";
}

/**
 * Compute the deepest nested path for nodes that satisfy the supplied predicate.
 */
export function computeMaxControlDepth(
  node: MorphNode,
  isNestingNode: (current: MorphNode) => boolean,
): number {
  let maxDepth = 0;

  const visit = (current: MorphNode, depth: number) => {
    const nextDepth = isNestingNode(current) ? depth + 1 : depth;
    maxDepth = Math.max(maxDepth, nextDepth);
    for (const child of current.getChildren()) {
      visit(child, nextDepth);
    }
  };

  visit(node, 0);
  return maxDepth;
}

/**
 * Build a structural fingerprint of a function body: a multiset of node-shape tokens
 * that ignores identifier and literal values. Two functions that share control-flow
 * and call shape produce similar fingerprints even when every name differs.
 */
export function structuralFingerprint(node: MorphNode): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (token: string) => counts.set(token, (counts.get(token) ?? 0) + 1);

  for (const descendant of node.getDescendants()) {
    switch (descendant.getKind()) {
      case SyntaxKind.IfStatement:
        bump("if");
        break;
      case SyntaxKind.ConditionalExpression:
        bump("ternary");
        break;
      case SyntaxKind.ForStatement:
      case SyntaxKind.ForOfStatement:
      case SyntaxKind.ForInStatement:
        bump("for");
        break;
      case SyntaxKind.WhileStatement:
      case SyntaxKind.DoStatement:
        bump("while");
        break;
      case SyntaxKind.SwitchStatement:
        bump("switch");
        break;
      case SyntaxKind.ReturnStatement:
        bump("return");
        break;
      case SyntaxKind.AwaitExpression:
        bump("await");
        break;
      case SyntaxKind.TryStatement:
        bump("try");
        break;
      case SyntaxKind.VariableDeclaration:
        bump("var");
        break;
      case SyntaxKind.BinaryExpression:
        bump("binop");
        break;
      case SyntaxKind.CallExpression: {
        const expression = (descendant as CallExpression).getExpression();
        bump(Node.isPropertyAccessExpression(expression) ? "call.prop" : "call.id");
        break;
      }
      case SyntaxKind.JsxElement:
      case SyntaxKind.JsxSelfClosingElement:
        bump("jsx");
        break;
      default:
        break;
    }
  }

  return counts;
}
