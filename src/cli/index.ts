#!/usr/bin/env node
import { Command } from "commander";
import { packageVersion } from "../utils/packageInfo.js";
import { registerAdoptCommand } from "./commands/adopt.js";
import { registerBaselineCommand } from "./commands/baseline.js";
import { registerCompletionsCommand } from "./commands/completions.js";
import { registerCompareCommand } from "./commands/compare.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerExplainCommand } from "./commands/explain.js";
import { registerInitCommand } from "./commands/init.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerPacksCommand } from "./commands/packs.js";
import { registerRulesCommand } from "./commands/rules.js";
import { registerScanCommand } from "./commands/scan.js";
import { registerSuppressCommand } from "./commands/suppress.js";
import { registerHistoryCommand } from "./commands/history.js";
import { registerCalibrateCommand } from "./commands/calibrate.js";
import { registerTriageCommand } from "./commands/triage.js";
import { registerFixCommand } from "./commands/fix.js";
import { registerWatchCommand } from "./commands/watch.js";

const program = new Command();

program
  .name("debtlens")
  .description("Find maintainability debt in TypeScript, JavaScript, Python, Vue/Svelte SFC scripts, Kotlin, Swift, Ruby, Jetpack Compose, and framework codebases.")
  .version(packageVersion);

registerScanCommand(program);
registerBaselineCommand(program);
registerDoctorCommand(program);
registerWatchCommand(program);
registerPacksCommand(program);
registerRulesCommand(program);
registerCompareCommand(program);
registerCompletionsCommand(program);
registerMcpCommand(program);
registerExplainCommand(program);
registerSuppressCommand(program);
registerInitCommand(program);
registerAdoptCommand(program);
registerHistoryCommand(program);
registerCalibrateCommand(program);
registerTriageCommand(program);
registerFixCommand(program);

if (process.argv.length <= 2) {
  program.help();
}

await program.parseAsync(process.argv);
