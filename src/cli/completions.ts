import { RULE_PACK_IDS } from "../config/packs.js";
import { severities } from "../core/severity.js";
import { detectorIds } from "../detectors/index.js";
import { SCAN_ARG_FLAGS } from "./argv.js";

const commands = ["scan", "doctor", "watch", "packs", "rules", "explain", "suppress", "init", "adopt", "mcp", "completions"];
const formats = ["terminal", "json", "markdown", "pr-comment", "sarif", "html", "junit"];
const scanFlags = [...SCAN_ARG_FLAGS, "--from-eslint", "--debounce"];

export type CompletionShell = "bash" | "zsh" | "fish";

export function renderCompletions(shell: CompletionShell): string {
  if (shell === "bash") return renderBash();
  if (shell === "zsh") return renderZsh();
  return renderFish();
}

function renderBash(): string {
  return `# DebtLens bash completions
_debtlens_complete() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  case "$prev" in
    --pack) COMPREPLY=( $(compgen -W "${RULE_PACK_IDS.join(" ")}" -- "$cur") ); return ;;
    --rules|explain|--rule) COMPREPLY=( $(compgen -W "${detectorIds.join(" ")}" -- "$cur") ); return ;;
    --min-severity|--fail-on) COMPREPLY=( $(compgen -W "${severities.join(" ")}" -- "$cur") ); return ;;
    --format) COMPREPLY=( $(compgen -W "${formats.join(" ")}" -- "$cur") ); return ;;
  esac
  COMPREPLY=( $(compgen -W "${[...commands, ...scanFlags].join(" ")}" -- "$cur") )
}
complete -F _debtlens_complete debtlens
`;
}

function renderZsh(): string {
  const flagSpecs = scanFlags
    .map((flag) => `    '${flag}' \\`)
    .join("\n");
  return `#compdef debtlens
_debtlens() {
  local -a commands flags packs rules severities formats
  commands=(${commands.join(" ")})
  flags=(${scanFlags.join(" ")})
  packs=(${RULE_PACK_IDS.join(" ")})
  rules=(${detectorIds.join(" ")})
  severities=(${severities.join(" ")})
  formats=(${formats.join(" ")})
  _arguments \
    '1:command:(${commands.join(" ")})' \
${flagSpecs}
    '--pack[rule pack]:pack:(${RULE_PACK_IDS.join(" ")})' \
    '--rules[rule ids]:rules:(${detectorIds.join(" ")})' \
    '--rule[rule id]:rule:(${detectorIds.join(" ")})' \
    '--min-severity[minimum severity]:severity:(${severities.join(" ")})' \
    '--fail-on[failing severity]:severity:(${severities.join(" ")})' \
    '--format[output format]:format:(${formats.join(" ")})' \
    '*::arg:->args'
}
_debtlens "$@"
`;
}

function renderFish(): string {
  const lines = [
    "# DebtLens fish completions",
    "complete -c debtlens -f",
    ...commands.map((command) => `complete -c debtlens -n "__fish_use_subcommand" -a "${command}"`),
    ...scanFlags.map((flag) => `complete -c debtlens -l ${flag.slice(2)}`),
    `complete -c debtlens -l pack -a "${RULE_PACK_IDS.join(" ")}"`,
    `complete -c debtlens -l rules -a "${detectorIds.join(" ")}"`,
    `complete -c debtlens -l rule -a "${detectorIds.join(" ")}"`,
    `complete -c debtlens -l min-severity -a "${severities.join(" ")}"`,
    `complete -c debtlens -l fail-on -a "${severities.join(" ")}"`,
    `complete -c debtlens -l format -a "${formats.join(" ")}"`,
  ];
  return `${lines.join("\n")}\n`;
}
