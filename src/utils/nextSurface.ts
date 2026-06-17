import { Node, SyntaxKind } from "ts-morph";
import type { Node as MorphNode } from "ts-morph";
import type { SourceFileInfo } from "../core/types.js";

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function hasUseClientDirective(file: SourceFileInfo): boolean {
  for (const statement of file.sourceFile.getStatements()) {
    if (!Node.isExpressionStatement(statement)) return false;
    const expression = statement.getExpression();
    if (!Node.isStringLiteral(expression)) return false;
    if (expression.getLiteralText() === "use client") return true;
    if (expression.getLiteralText() !== "use strict") return false;
  }

  return false;
}

export function isRoutePathArgument(node: MorphNode): boolean {
  return Node.isStringLiteral(node)
    || Node.isNoSubstitutionTemplateLiteral(node)
    || Node.isRegularExpressionLiteral(node);
}

export function isLikelyNextServerComponentFile(file: SourceFileInfo): boolean {
  const path = normalizePath(file.relativePath);
  if (!/\.[jt]sx$/.test(path)) return false;
  if (!/(^|\/)app\//.test(path)) return false;
  if (/(^|\/)app\/.*\/route\.[jt]sx?$/.test(path)) return false;

  return file.sourceFile.getDescendants().some((node) =>
    node.getKind() === SyntaxKind.JsxElement
    || node.getKind() === SyntaxKind.JsxSelfClosingElement
    || node.getKind() === SyntaxKind.JsxFragment,
  );
}
