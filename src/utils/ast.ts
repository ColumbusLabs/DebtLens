import { Node, SyntaxKind } from "ts-morph";
import type { ArrowFunction, CallExpression, FunctionDeclaration, FunctionExpression, Node as MorphNode, SourceFile, VariableDeclaration } from "ts-morph";
import type { SourceFileInfo } from "../core/types.js";
import { isHookName, isPascalCase } from "./identifiers.js";

export type FunctionNode = FunctionDeclaration | ArrowFunction | FunctionExpression;

export interface FunctionLikeInfo {
  name: string;
  node: FunctionNode;
  declaration: FunctionDeclaration | VariableDeclaration;
  file: SourceFileInfo;
  classification: "component" | "hook" | "function";
}

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
    });
  }

  for (const declaration of file.sourceFile.getVariableDeclarations()) {
    const name = declaration.getName();
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
      results.push({
        name,
        node: initializer,
        declaration,
        file,
        classification: classifyFunctionName(name),
      });
    }
  }

  return results;
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
