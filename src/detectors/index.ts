import type { Detector } from "../core/types.js";
import { deadAbstractionDetector } from "./deadAbstraction.js";
import { duplicateLogicDetector } from "./duplicateLogic.js";
import { effectComplexityDetector } from "./effectComplexity.js";
import { largeComponentDetector } from "./largeComponent.js";
import { namingDriftDetector } from "./namingDrift.js";
import { propDrillingDetector } from "./propDrilling.js";
import { stateSprawlDetector } from "./stateSprawl.js";
import { todoCommentDetector } from "./todoComment.js";

export const allDetectors: Detector[] = [
  largeComponentDetector,
  stateSprawlDetector,
  effectComplexityDetector,
  duplicateLogicDetector,
  deadAbstractionDetector,
  propDrillingDetector,
  todoCommentDetector,
  namingDriftDetector,
];

export const detectorIds = allDetectors.map((detector) => detector.id);
