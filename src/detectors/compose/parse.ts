import { countKotlinBranches, maskKotlinTrivia, type KotlinFunction } from "../kotlin/parse.js";

export interface ComposeStateHolder {
  name?: string;
  line: string;
}

const composableAnnotation = /@(?:[\w.]+\.)?Composable\b/;
const previewAnnotation = /@(?:[\w.]+\.)?Preview\b/;

export function isComposableFunction(fn: KotlinFunction): boolean {
  return fn.annotations.some((annotation) => composableAnnotation.test(annotation));
}

export function isPreviewComposable(fn: KotlinFunction): boolean {
  return fn.annotations.some((annotation) => previewAnnotation.test(annotation));
}

export function countComposeBranches(fn: KotlinFunction): number {
  return countKotlinBranches(fn);
}

export function collectComposeStateHolders(fn: KotlinFunction): ComposeStateHolder[] {
  const holders: ComposeStateHolder[] = [];
  const rawBody = fn.bodyLines.join("\n");
  const body = maskKotlinTrivia(rawBody);
  const declarationPattern = /\b(?:val|var)\s+([A-Za-z_]\w*)\b[\s\S]*?(?=\n\s*(?:val|var)\s+[A-Za-z_]\w*\b|$)/g;

  for (const match of body.matchAll(declarationPattern)) {
    const declaration = match[0] ?? "";
    if (!isComposeStateDeclaration(declaration)) continue;
    const start = match.index ?? 0;
    holders.push({
      name: match[1],
      line: rawBody.slice(start, start + declaration.length).replace(/\s+/g, " ").trim().slice(0, 160),
    });
  }

  return holders;
}

export function countHoistedComposeStateSignals(fn: KotlinFunction): number {
  return fn.parameterTexts.filter((param) => {
    const normalized = param.replace(/\s+/g, " ");
    return /:\s*(?:MutableState|State|SnapshotStateList|SnapshotStateMap)\s*[<\?]/.test(normalized)
      || /:\s*\([^)]*\)\s*->/.test(normalized)
      || /:\s*[A-Za-z_]\w*State\b/.test(normalized);
  }).length;
}

function isComposeStateDeclaration(declaration: string): boolean {
  return /\b(?:val|var)\s+[A-Za-z_]\w*\b/.test(declaration)
    && (
      /\bremember(?:Saveable)?\s*(?:\([^)]*\))?\s*\{[\s\S]*?\bmutable[A-Za-z]*StateOf(?:<[^>]+>)?\s*\(/.test(declaration)
      || /\bremember[A-Za-z]*State\s*\(/.test(declaration)
      || /\bderivedStateOf\s*\{/.test(declaration)
      || /\bmutable(?:State|StateList|StateMap)Of(?:<[^>]+>)?\s*\(/.test(declaration)
      || /\bproduceState\s*\(/.test(declaration)
    );
}
