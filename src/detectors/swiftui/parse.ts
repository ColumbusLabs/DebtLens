import { countSwiftViewBranches, maskSwiftTrivia, type SwiftViewStruct } from "../swift/parse.js";

export interface SwiftUIStateHolder {
  name?: string;
  line: string;
}

const swiftUIStateAttribute = /@(?:State|StateObject|ObservedObject|FocusState|GestureState|SceneStorage|AppStorage)\b/;
const previewMacro = /#Preview\b/;
const previewProvider = /\bPreviewProvider\b/;

export function isSwiftUIView(view: SwiftViewStruct): boolean {
  return view.conformsTo.some((type) => /\bView\b/.test(type));
}

export function isPreviewView(view: SwiftViewStruct, fileContent: string, startLine: number): boolean {
  if (view.attributes.some((attribute) => previewMacro.test(attribute))) return true;
  if (view.conformsTo.some((type) => previewProvider.test(type))) return true;
  return collectLeadingPreviewMarkers(fileContent, startLine).length > 0;
}

export function countSwiftUIBranches(view: SwiftViewStruct): number {
  return countSwiftViewBranches(view);
}

export function collectSwiftUIStateHolders(view: SwiftViewStruct): SwiftUIStateHolder[] {
  const holders: SwiftUIStateHolder[] = [];
  const rawBody = view.bodyLines.join("\n");
  const body = maskSwiftTrivia(rawBody);

  for (const declaration of view.propertyDeclarations) {
    if (!isSwiftUIStateDeclaration(declaration)) continue;
    const name = declaration.match(/\b(?:var|let)\s+([A-Za-z_]\w*)/)?.[1];
    holders.push({
      name,
      line: declaration.replace(/\s+/g, " ").trim().slice(0, 160),
    });
  }

  const declarationPattern = /\b(?:@State|@StateObject|@ObservedObject|@FocusState|@GestureState|@SceneStorage|@AppStorage)\b[\s\S]*?(?=\n\s*(?:@|var|let|func)\b|$)/g;
  for (const match of body.matchAll(declarationPattern)) {
    const declaration = match[0] ?? "";
    if (!isSwiftUIStateDeclaration(declaration)) continue;
    const start = match.index ?? 0;
    holders.push({
      name: declaration.match(/\b(?:var|let)\s+([A-Za-z_]\w*)/)?.[1],
      line: rawBody.slice(start, start + declaration.length).replace(/\s+/g, " ").trim().slice(0, 160),
    });
  }

  return dedupeStateHolders(holders);
}

export function countHoistedSwiftUIStateSignals(view: SwiftViewStruct): number {
  const header = maskSwiftTrivia(view.text.split("{")[0] ?? "");
  return (header.match(/\b(?:Binding<|@Binding\b|ObservedObject|StateObject|@ObservedObject|@StateObject)\b/g) ?? []).length
    + (header.match(/:\s*\([^)]*\)\s*->/g) ?? []).length;
}

function isSwiftUIStateDeclaration(declaration: string): boolean {
  const trimmed = declaration.trim();
  return /^(?:@\w+(?:\([^)]*\))?\s+)+(?:private|fileprivate|internal|public|open)?\s*(?:var|let)\b/.test(trimmed)
    && /@(?:State|StateObject|ObservedObject|FocusState|GestureState|SceneStorage|AppStorage)(?:\([^)]*\))?/.test(trimmed);
}

function collectLeadingPreviewMarkers(fileContent: string, startLine: number): string[] {
  const lines = fileContent.split(/\r?\n/);
  const markers: string[] = [];
  for (let cursor = startLine - 2; cursor >= 0 && cursor >= startLine - 4; cursor -= 1) {
    const trimmed = (lines[cursor] ?? "").trim();
    if (!trimmed) continue;
    if (previewMacro.test(trimmed)) {
      markers.push(trimmed);
      continue;
    }
    break;
  }
  return markers;
}

function dedupeStateHolders(holders: SwiftUIStateHolder[]): SwiftUIStateHolder[] {
  const seen = new Set<string>();
  return holders.filter((holder) => {
    const key = holder.name ?? holder.line;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
