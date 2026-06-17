import type { Detector } from "../core/types.js";
import { apiSurfaceSprawlDetector } from "./apiSurfaceSprawl.js";
import { barrelFileDetector } from "./barrelFile.js";
import { contextProviderSprawlDetector } from "./contextProviderSprawl.js";
import { dataLoaderSprawlDetector } from "./dataLoaderSprawl.js";
import { deadAbstractionDetector } from "./deadAbstraction.js";
import { duplicateLogicDetector } from "./duplicateLogic.js";
import { duplicatedLiteralDetector } from "./duplicatedLiteral.js";
import { effectComplexityDetector } from "./effectComplexity.js";
import { handlerDepthDetector } from "./handlerDepth.js";
import { hookDependencySmellDetector } from "./hookDependencySmell.js";
import { largeComponentDetector } from "./largeComponent.js";
import { largeFunctionDetector } from "./largeFunction.js";
import { namingDriftDetector } from "./namingDrift.js";
import { propDrillingDetector } from "./propDrilling.js";
import { rnHostForwardingDetector } from "./rnHostForwarding.js";
import { routeHandlerSizeDetector } from "./routeHandlerSize.js";
import { routeSprawlDetector } from "./routeSprawl.js";
import { serverClientBoundaryDetector } from "./serverClientBoundary.js";
import { stateSprawlDetector } from "./stateSprawl.js";
import { storyOnlyComponentDetector } from "./storyOnlyComponent.js";
import { todoCommentDetector } from "./todoComment.js";
import { weakTestBoundaryDetector } from "./weakTestBoundary.js";

export const allDetectors: Detector[] = [
  largeComponentDetector,
  largeFunctionDetector,
  stateSprawlDetector,
  effectComplexityDetector,
  hookDependencySmellDetector,
  contextProviderSprawlDetector,
  rnHostForwardingDetector,
  serverClientBoundaryDetector,
  routeHandlerSizeDetector,
  dataLoaderSprawlDetector,
  handlerDepthDetector,
  routeSprawlDetector,
  duplicateLogicDetector,
  duplicatedLiteralDetector,
  deadAbstractionDetector,
  propDrillingDetector,
  todoCommentDetector,
  namingDriftDetector,
  barrelFileDetector,
  weakTestBoundaryDetector,
  apiSurfaceSprawlDetector,
  storyOnlyComponentDetector,
];

export const detectorIds = allDetectors.map((detector) => detector.id);
