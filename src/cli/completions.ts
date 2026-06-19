import { RULE_PACK_IDS } from "../config/packs.js";
import { severities } from "../core/severity.js";
import { detectorIds } from "../detectors/index.js";
import { SCAN_ARG_FLAGS } from "./argv.js";

const commands = ["scan", "doctor", "watch", "packs", "rules", "explain", "suppress", "baseline", "init", "adopt", "mcp", "completions"];
const baselineSubcommands = ["diff", "prune", "update"];
const baselineFlags = [
  "--baseline",
  "--format",
  "--dry-run",
  "--include",
  "--exclude",
  "--min-severity",
  "--pack",
  "--rules",
  "--threshold",
  "--max-files",
  "--respect-gitignore",
  "--config",
  "--cwd",
  "--package",
  "--cache",
  "--parallel",
  "--batch-size",
];
const formats = ["terminal", "json", "markdown", "pr-comment", "sarif", "html", "junit"];
const baselineFormats = ["terminal", "json"];
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
  if [[ "\${COMP_WORDS[1]}" == "baseline" && "$prev" == "--format" ]]; then
    COMPREPLY=( $(compgen -W "${baselineFormats.join(" ")}" -- "$cur") )
    return
  fi
  case "$prev" in
    --pack) COMPREPLY=( $(compgen -W "${RULE_PACK_IDS.join(" ")}" -- "$cur") ); return ;;
    --rules|explain|--rule) COMPREPLY=( $(compgen -W "${detectorIds.join(" ")}" -- "$cur") ); return ;;
    --min-severity|--fail-on) COMPREPLY=( $(compgen -W "${severities.join(" ")}" -- "$cur") ); return ;;
    --format) COMPREPLY=( $(compgen -W "${formats.join(" ")}" -- "$cur") ); return ;;
  esac
  if [[ "\${COMP_WORDS[1]}" == "baseline" ]]; then
    if [[ $COMP_CWORD -eq 2 ]]; then
      COMPREPLY=( $(compgen -W "${baselineSubcommands.join(" ")}" -- "$cur") )
      return
    fi
    COMPREPLY=( $(compgen -W "${baselineFlags.join(" ")}" -- "$cur") )
    return
  fi
  COMPREPLY=( $(compgen -W "${[...commands, ...scanFlags].join(" ")}" -- "$cur") )
}
complete -F _debtlens_complete debtlens
`;
}

function renderZsh(): string {
  const flagSpecs = scanFlags
    .map((flag) => `    '${flag}' \\`)
    .join("\n");
  const baselineFlagSpecs = baselineFlags
    .map((flag) => `      '${flag}' \\`)
    .join("\n");
  return `#compdef debtlens
_debtlens() {
  local -a commands flags baseline_subcommands packs rules severities formats
  commands=(${commands.join(" ")})
  flags=(${scanFlags.join(" ")})
  baseline_subcommands=(${baselineSubcommands.join(" ")})
  packs=(${RULE_PACK_IDS.join(" ")})
  rules=(${detectorIds.join(" ")})
  severities=(${severities.join(" ")})
  formats=(${formats.join(" ")})
  if [[ \${words[2]} == baseline ]]; then
    _arguments \\
      '2:baseline subcommand:(${baselineSubcommands.join(" ")})' \\
${baselineFlagSpecs}
      '*:path:_files'
    return
  fi
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
  const baselineCondition = "__fish_seen_subcommand_from baseline";
  const nonBaselineCondition = "not __fish_seen_subcommand_from baseline";
  const lines = [
    "# DebtLens fish completions",
    "complete -c debtlens -f",
    ...commands.map((command) => `complete -c debtlens -n "__fish_use_subcommand" -a "${command}"`),
    `complete -c debtlens -n "${baselineCondition}; and not __fish_seen_subcommand_from ${baselineSubcommands.join(" ")}" -a "${baselineSubcommands.join(" ")}"`,
    ...baselineFlags.map((flag) => `complete -c debtlens -n "${baselineCondition}" -l ${flag.slice(2)}`),
    ...scanFlags.map((flag) => `complete -c debtlens -n "${nonBaselineCondition}" -l ${flag.slice(2)}`),
    `complete -c debtlens -n "${nonBaselineCondition}" -l pack -a "${RULE_PACK_IDS.join(" ")}"`,
    `complete -c debtlens -n "${nonBaselineCondition}" -l rules -a "${detectorIds.join(" ")}"`,
    `complete -c debtlens -n "${nonBaselineCondition}" -l rule -a "${detectorIds.join(" ")}"`,
    `complete -c debtlens -n "${nonBaselineCondition}" -l min-severity -a "${severities.join(" ")}"`,
    `complete -c debtlens -n "${nonBaselineCondition}" -l fail-on -a "${severities.join(" ")}"`,
    `complete -c debtlens -n "${nonBaselineCondition}" -l format -a "${formats.join(" ")}"`,
    `complete -c debtlens -n "${baselineCondition}" -l pack -a "${RULE_PACK_IDS.join(" ")}"`,
    `complete -c debtlens -n "${baselineCondition}" -l rules -a "${detectorIds.join(" ")}"`,
    `complete -c debtlens -n "${baselineCondition}" -l min-severity -a "${severities.join(" ")}"`,
    `complete -c debtlens -n "${baselineCondition}" -l format -a "${baselineFormats.join(" ")}"`,
  ];
  return `${lines.join("\n")}\n`;
}
