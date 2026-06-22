import { Node, Project, SyntaxKind, ts } from "ts-morph";
import type { Node as MorphNode, VariableDeclaration } from "ts-morph";
import { resolve } from "node:path";
import { scan } from "../core/scan.js";
import type { DebtIssue, ScanOptions } from "../core/types.js";
import { collectFunctionLikes, getFunctionBody } from "../utils/ast.js";
import { nodeLineSpan } from "../utils/lines.js";

const FIXABLE_RULES = new Set(["duplicated-literal", "dead-abstraction"]);

export interface FixResult {
  diffs: string[];
  filesTouched: number;
  dryRun: boolean;
}

export async function runFix(options: ScanOptions, input: {
  rules?: string[];
  dryRun?: boolean;
}): Promise<FixResult> {
  const allowedRules = (input.rules ?? [...FIXABLE_RULES]).filter((rule) => FIXABLE_RULES.has(rule));
  const result = await scan({ ...options, rules: allowedRules.length ? allowedRules : [...FIXABLE_RULES] });
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
    skipAddingFilesFromTsConfig: true,
  });

  const diffs: string[] = [];
  const touched = new Set<string>();
  for (const issue of result.issues) {
    if (issue.ruleId === "duplicated-literal") {
      const literal = extractDuplicatedLiteral(issue);
      if (!literal) continue;
      const files = collectIssueFiles(issue);
      for (const file of files) {
        const diff = fixDuplicatedLiteral(project, options, file, literal);
        if (diff) {
          diffs.push(diff);
          touched.add(file);
        }
      }
    }
    if (issue.ruleId === "dead-abstraction") {
      const diff = fixDeadAbstraction(project, options, issue);
      if (diff) {
        diffs.push(diff);
        touched.add(issue.file);
      }
    }
  }

  if (!input.dryRun) {
    await project.save();
    const verify = await scan({ ...options, rules: allowedRules.length ? allowedRules : [...FIXABLE_RULES] });
    for (const issue of result.issues) {
      const stillPresent = verify.issues.some((candidate) =>
        candidate.ruleId === issue.ruleId
        && candidate.file === issue.file
        && candidate.location?.startLine === issue.location?.startLine,
      );
      if (stillPresent) {
        throw new Error(`Fix did not resolve ${issue.ruleId} at ${issue.file}:${issue.location?.startLine ?? "?"}`);
      }
    }
  }

  return { diffs, filesTouched: touched.size, dryRun: input.dryRun !== false };
}

function collectIssueFiles(issue: DebtIssue): string[] {
  const files = new Set<string>([issue.file]);
  for (const line of issue.evidence ?? []) {
    const file = line.split(":")[0];
    if (file) files.add(file);
  }
  return [...files];
}

function extractDuplicatedLiteral(issue: DebtIssue): string | undefined {
  const prefix = issue.message.match(/^(.+?) is repeated /)?.[1];
  if (!prefix) return undefined;
  if (prefix.startsWith("\"") || prefix.startsWith("'")) {
    try {
      return JSON.parse(prefix) as string;
    } catch {
      return undefined;
    }
  }
  return prefix;
}

function fixDuplicatedLiteral(project: Project, options: ScanOptions, relativePath: string, literal: string): string | undefined {
  const absolutePath = resolve(options.target, relativePath);
  const source = project.addSourceFileAtPathIfExists(absolutePath) ?? project.createSourceFile(absolutePath, "", { overwrite: true });
  const constName = `SHARED_${literal.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase().slice(0, 24)}`;
  if (!source.getVariableDeclaration(constName)) {
    source.insertStatements(0, `const ${constName} = ${JSON.stringify(literal)};\n`);
  }
  const before = source.getFullText();
  for (const node of source.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    if (node.getLiteralValue() === literal) {
      node.replaceWithText(constName);
    }
  }
  const after = source.getFullText();
  if (before === after) return undefined;
  return `--- ${relativePath}\n+++ ${relativePath}\n${after}`;
}

function fixDeadAbstraction(project: Project, options: ScanOptions, issue: DebtIssue): string | undefined {
  const absolutePath = resolve(options.target, issue.file);
  const source = project.addSourceFileAtPathIfExists(absolutePath);
  if (!source) return undefined;

  const fileInfo = {
    relativePath: issue.file,
    absolutePath,
    sourceFile: source,
    content: source.getFullText(),
    language: "tsjs" as const,
  };

  for (const fn of collectFunctionLikes(fileInfo)) {
    const body = getFunctionBody(fn.node);
    if (!body) continue;
    const span = nodeLineSpan(body);
    if (span.startLine !== issue.location?.startLine) continue;

    const delegation = getPassThroughDelegation(body, fn.node, fn.name);
    if (!delegation) return undefined;

    const before = source.getFullText();
    inlinePassThroughWrapper(source, fn, delegation.calleeText);
    const after = source.getFullText();
    if (before === after) return undefined;
    return `--- ${issue.file}\n+++ ${issue.file}\n${after}`;
  }

  return undefined;
}

function getPassThroughDelegation(body: MorphNode, fnNode: MorphNode, fnName: string): { calleeText: string } | undefined {
  const paramNames = extractParamNames(fnNode);
  if (!paramNames) return undefined;

  const expression = readSingleReturnExpression(body);
  if (!expression || !Node.isCallExpression(expression)) return undefined;

  const args = expression.getArguments();
  if (args.length !== paramNames.length) return undefined;
  if (!args.every((arg, index) => Node.isIdentifier(arg) && arg.getText() === paramNames[index])) {
    return undefined;
  }

  return { calleeText: expression.getExpression().getText() };
}

function readSingleReturnExpression(body: MorphNode): MorphNode | undefined {
  if (Node.isBlock(body)) {
    const statements = body.getStatements();
    if (statements.length !== 1) return undefined;
    const only = statements[0];
    if (!only || !Node.isReturnStatement(only)) return undefined;
    return only.getExpression() ?? undefined;
  }
  return body;
}

function extractParamNames(node: MorphNode): string[] | null {
  const parameters = Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node) || Node.isArrowFunction(node)
    ? node.getParameters()
    : [];
  const names: string[] = [];
  for (const param of parameters) {
    const nameNode = param.getNameNode();
    if (!Node.isIdentifier(nameNode)) return null;
    names.push(nameNode.getText());
  }
  return names;
}

function inlinePassThroughWrapper(
  source: ReturnType<Project["addSourceFileAtPathIfExists"]>,
  fn: ReturnType<typeof collectFunctionLikes>[number],
  calleeText: string,
): void {
  if (!source) return;
  const fnName = fn.name;

  for (const identifier of source.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (identifier.getText() !== fnName) continue;
    if (isDeclarationName(identifier, fnName)) continue;
    const parent = identifier.getParent();
    if (!Node.isCallExpression(parent) || parent.getExpression() !== identifier) continue;
    parent.getExpression().replaceWithText(calleeText);
  }

  if (Node.isFunctionDeclaration(fn.declaration)) {
    fn.declaration.remove();
    return;
  }

  const variableDeclaration = fn.declaration as VariableDeclaration;
  variableDeclaration.remove();
}

function isDeclarationName(identifier: MorphNode, fnName: string): boolean {
  const parent = identifier.getParent();
  if (Node.isFunctionDeclaration(parent) && parent.getName() === fnName) return true;
  if (Node.isVariableDeclaration(parent) && parent.getName() === fnName) return true;
  return false;
}
