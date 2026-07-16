import { Node, SyntaxKind } from "ts-morph";
import type { CallExpression, Node as MorphNode } from "ts-morph";
import type {
  DebtIssue,
  Detector,
  FeatureFlagAccessPattern,
  FeatureFlagsConfig,
  SourceFileInfo,
} from "../core/types.js";
import { defaultConfig } from "../config/defaults.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

interface FlagDefinition {
  file: string;
  line: number;
  key: string;
  value: boolean;
  registry: boolean;
  referenced?: boolean;
  conditionallyReferenced?: boolean;
  unknownReference?: boolean;
}

interface References {
  keys: Set<string>;
  conditionalKeys: Set<string>;
  unknownKeyAccess: boolean;
}

interface RegistryReceiver {
  declaration: MorphNode;
  name: string;
  definitionsByKey: Map<string, FlagDefinition[]>;
}

export const featureFlagDebtDetector: Detector = {
  id: "stale-feature-flag",
  name: "Stale feature flag",
  description: "Flags configured feature flags that are permanently enabled/disabled or unused.",
  defaultSeverity: "medium",
  tags: ["feature-flags", "cleanup", "maintainability"],
  defaultEnabled: false,
  detect(context): DebtIssue[] {
    const config = resolveConfig(context.options.featureFlags);
    const registryMatchers = config.registryGlobs.map(globToRegExp);
    const nameMatchers = config.constantNamePatterns.map((pattern) => new RegExp(pattern));
    const { definitions, registryReceivers } = collectDefinitions(context.files, registryMatchers, nameMatchers);
    const references = collectReferences(context.files, config.accessPatterns, registryReceivers);

    return definitions.flatMap((definition) => {
      const configuredKeyReference = definition.registry && references.keys.has(definition.key);
      const configuredConditionalReference = definition.registry && references.conditionalKeys.has(definition.key);
      const referenced = definition.referenced === true || configuredKeyReference;
      const conditionallyReferenced = definition.conditionallyReferenced === true || configuredConditionalReference;

      if (definition.registry && !referenced && !definition.unknownReference && !references.unknownKeyAccess) {
        return [createIssue({
          detector: featureFlagDebtDetector,
          confidence: 0.9,
          file: definition.file,
          location: { startLine: definition.line, endLine: definition.line },
          message: `Feature flag ${definition.key} is defined in a configured registry but never referenced.`,
          evidence: [`Registry definition: ${definition.key} = ${String(definition.value)}`],
          suggestion: "Remove the unused registry entry, or add a configured access-pattern reference if the flag is still active.",
        })];
      }

      if (!conditionallyReferenced) return [];
      return [createIssue({
        detector: featureFlagDebtDetector,
        confidence: definition.registry ? 0.9 : 0.82,
        file: definition.file,
        location: { startLine: definition.line, endLine: definition.line },
        message: `Feature flag ${definition.key} is hardcoded to ${definition.value}.`,
        evidence: [
          `Literal value: ${String(definition.value)}`,
          "The flag is referenced by conditional control flow.",
        ],
        suggestion: "Remove the flag check and unreachable branch once rollout is complete, or source the value from a real flag provider.",
      })];
    });
  },
};

function resolveConfig(config: FeatureFlagsConfig | undefined): Required<FeatureFlagsConfig> {
  return {
    accessPatterns: config?.accessPatterns ?? defaultConfig.featureFlags.accessPatterns ?? [],
    registryGlobs: config?.registryGlobs ?? defaultConfig.featureFlags.registryGlobs ?? [],
    constantNamePatterns: config?.constantNamePatterns ?? defaultConfig.featureFlags.constantNamePatterns ?? [],
  };
}

function collectDefinitions(
  files: SourceFileInfo[],
  registryMatchers: RegExp[],
  nameMatchers: RegExp[],
): { definitions: FlagDefinition[]; registryReceivers: RegistryReceiver[] } {
  const definitions: FlagDefinition[] = [];
  const receiversByDeclaration = new Map<MorphNode, RegistryReceiver>();

  for (const file of files) {
    const isRegistry = registryMatchers.some((matcher) => matcher.test(normalizePath(file.relativePath)));

    for (const declaration of file.sourceFile.getVariableDeclarations()) {
      if (!isTopLevelVariable(declaration)) continue;
      const value = readBooleanLiteral(declaration.getInitializer());
      if (value === undefined) continue;
      const key = declaration.getName();
      if (!isRegistry && !nameMatchers.some((matcher) => matcher.test(key))) continue;
      const nameNode = declaration.getNameNode();
      const referenceNodes = Node.isIdentifier(nameNode) ? nameNode.findReferencesAsNodes() : [];
      definitions.push({
        ...definitionFor(file, declaration, key, value, isRegistry),
        referenced: referenceNodes.length > 0,
        conditionallyReferenced: referenceNodes.some(isUsedAsCondition),
      });
    }

    if (!isRegistry) continue;
    for (const property of file.sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
      if (!Node.isObjectLiteralExpression(property.getParent())) continue;
      const value = readBooleanLiteral(property.getInitializer());
      const key = readPropertyName(property.getNameNode());
      if (value === undefined || key === undefined) continue;
      const definition = definitionFor(file, property, key, value, true);
      definitions.push(definition);

      const objectLiteral = property.getParent();
      const declaration = objectLiteral.getParent();
      if (!Node.isVariableDeclaration(declaration)
        || declaration.getInitializer() !== objectLiteral
        || !isTopLevelVariable(declaration)) continue;
      const nameNode = declaration.getNameNode();
      if (!Node.isIdentifier(nameNode)) continue;
      const receiver = receiversByDeclaration.get(declaration) ?? {
        declaration,
        name: nameNode.getText(),
        definitionsByKey: new Map<string, FlagDefinition[]>(),
      };
      const keyDefinitions = receiver.definitionsByKey.get(key) ?? [];
      keyDefinitions.push(definition);
      receiver.definitionsByKey.set(key, keyDefinitions);
      receiversByDeclaration.set(declaration, receiver);
    }
  }

  return { definitions, registryReceivers: [...receiversByDeclaration.values()] };
}

function definitionFor(
  file: SourceFileInfo,
  node: MorphNode,
  key: string,
  value: boolean,
  registry: boolean,
): FlagDefinition {
  return {
    file: file.relativePath,
    line: nodeLineSpan(node).startLine,
    key,
    value,
    registry,
  };
}

function collectReferences(
  files: SourceFileInfo[],
  patterns: FeatureFlagAccessPattern[],
  registryReceivers: RegistryReceiver[],
): References {
  const references: References = {
    keys: new Set(),
    conditionalKeys: new Set(),
    unknownKeyAccess: false,
  };

  for (const file of files) {
    for (const access of file.sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      const receiver = findRegistryReceiver(access.getExpression(), registryReceivers);
      if (receiver) markRegistryReference(receiver, access.getName(), isUsedAsCondition(access));
    }
    for (const access of file.sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
      const receiver = findRegistryReceiver(access.getExpression(), registryReceivers);
      if (!receiver) continue;
      const key = readLiteralKey(access.getArgumentExpression());
      if (key === undefined) {
        markUnknownRegistryReference(receiver);
        continue;
      }
      markRegistryReference(receiver, key, isUsedAsCondition(access));
    }

    for (const call of file.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const pattern = patterns.find((candidate) => callMatchesPattern(call, candidate));
      if (!pattern) continue;
      const key = readLiteralKey(call.getArguments()[pattern.keyArgument ?? 0]);
      if (key === undefined) {
        references.unknownKeyAccess = true;
        continue;
      }
      references.keys.add(key);
      if (isUsedAsCondition(call)) references.conditionalKeys.add(key);
    }
  }

  return references;
}

function findRegistryReceiver(expression: MorphNode, receivers: RegistryReceiver[]): RegistryReceiver | undefined {
  const symbol = expression.getSymbol();
  const canonicalSymbol = symbol?.getAliasedSymbol() ?? symbol;
  const declarations = canonicalSymbol?.getDeclarations() ?? [];
  const symbolicMatch = receivers.find((receiver) => declarations.includes(receiver.declaration));
  if (symbolicMatch) return symbolicMatch;
  if (!Node.isIdentifier(expression)) return undefined;

  const importedMatch = findImportedRegistryReceiver(expression, receivers);
  if (importedMatch) return importedMatch;
  if (declarations.length > 0) return undefined;

  const nameMatches = receivers.filter((receiver) => receiver.name === expression.getText());
  return nameMatches.length === 1 ? nameMatches[0] : undefined;
}

function findImportedRegistryReceiver(
  expression: MorphNode,
  receivers: RegistryReceiver[],
): RegistryReceiver | undefined {
  if (!Node.isIdentifier(expression)) return undefined;
  const localName = expression.getText();
  for (const importDeclaration of expression.getSourceFile().getImportDeclarations()) {
    const importedSource = importDeclaration.getModuleSpecifierSourceFile();
    if (!importedSource) continue;
    for (const namedImport of importDeclaration.getNamedImports()) {
      const importedLocalName = namedImport.getAliasNode()?.getText() ?? namedImport.getName();
      if (importedLocalName !== localName) continue;
      const receiver = receivers.find((candidate) =>
        candidate.name === namedImport.getName()
        && candidate.declaration.getSourceFile() === importedSource);
      if (receiver) return receiver;
    }
  }
  return undefined;
}

function markUnknownRegistryReference(receiver: RegistryReceiver): void {
  for (const definitions of receiver.definitionsByKey.values()) {
    for (const definition of definitions) {
      definition.unknownReference = true;
    }
  }
}

function markRegistryReference(receiver: RegistryReceiver, key: string, conditional: boolean): void {
  for (const definition of receiver.definitionsByKey.get(key) ?? []) {
    definition.referenced = true;
    if (conditional) definition.conditionallyReferenced = true;
  }
}

function callMatchesPattern(call: CallExpression, pattern: FeatureFlagAccessPattern): boolean {
  return call.getExpression().getText() === pattern.callee;
}

function isUsedAsCondition(node: MorphNode): boolean {
  let current: MorphNode = node;
  while (true) {
    const parent = current.getParent();
    if (!parent) return false;
    if (Node.isParenthesizedExpression(parent) || Node.isPrefixUnaryExpression(parent)) {
      current = parent;
      continue;
    }
    if (Node.isBinaryExpression(parent)) {
      current = parent;
      continue;
    }
    if (Node.isIfStatement(parent)) return parent.getExpression() === current;
    if (Node.isConditionalExpression(parent)) return parent.getCondition() === current;
    if (Node.isWhileStatement(parent) || Node.isDoStatement(parent)) return parent.getExpression() === current;
    if (Node.isForStatement(parent)) return parent.getCondition() === current;
    return false;
  }
}

function readBooleanLiteral(node: MorphNode | undefined): boolean | undefined {
  if (!node) return undefined;
  if (Node.isTrueLiteral(node)) return true;
  if (Node.isFalseLiteral(node)) return false;
  return undefined;
}

function readPropertyName(node: MorphNode): string | undefined {
  if (Node.isIdentifier(node) || Node.isStringLiteral(node) || Node.isNumericLiteral(node)) {
    return Node.isStringLiteral(node) ? node.getLiteralValue() : node.getText();
  }
  return undefined;
}

function readLiteralKey(node: MorphNode | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  return undefined;
}

function isTopLevelVariable(node: MorphNode): boolean {
  return Node.isVariableDeclaration(node)
    && node.getVariableStatement()?.getParent() === node.getSourceFile();
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function globToRegExp(glob: string): RegExp {
  const normalized = normalizePath(glob);
  let regex = "^";
  for (let index = 0; index < normalized.length;) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        if (normalized[index + 2] === "/") {
          regex += "(?:.*/)?";
          index += 3;
        } else {
          regex += ".*";
          index += 2;
        }
      } else {
        regex += "[^/]*";
        index += 1;
      }
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      index += 1;
      continue;
    }
    regex += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    index += 1;
  }
  return new RegExp(`${regex}$`);
}
