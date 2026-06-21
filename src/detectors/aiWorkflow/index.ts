export { instructionContradictionDetector } from "./instructionContradiction.js";
export { instructionDuplicationDetector } from "./instructionDuplication.js";
export {
  extractInstructionBlocks,
  INSTRUCTION_FILE_GLOBS,
  isInstructionFile,
  normalizeInstructionBlock,
  resolveInstructionFiles,
} from "./parse.js";
