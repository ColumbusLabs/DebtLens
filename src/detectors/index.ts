import type { Detector } from "../core/types.js";
import { composeLargeComposableDetector, composeStateHoistingDetector } from "./compose/index.js";
import { apiSurfaceSprawlDetector } from "./apiSurfaceSprawl.js";
import { barrelFileDetector } from "./barrelFile.js";
import { contextProviderSprawlDetector } from "./contextProviderSprawl.js";
import { complexControlFlowDetector } from "./complexControlFlow.js";
import { configDriftDetector } from "./configDrift.js";
import { dataLoaderSprawlDetector } from "./dataLoaderSprawl.js";
import { deadAbstractionDetector } from "./deadAbstraction.js";
import { duplicateLogicDetector } from "./duplicateLogic.js";
import { duplicatedLiteralDetector } from "./duplicatedLiteral.js";
import { effectComplexityDetector } from "./effectComplexity.js";
import { handlerDepthDetector } from "./handlerDepth.js";
import { hookDependencySmellDetector } from "./hookDependencySmell.js";
import { importCycleDetector } from "./importCycle.js";
import { kotlinDeadAbstractionDetector, kotlinDuplicateLogicDetector, kotlinLargeFunctionDetector, kotlinTodoCommentDetector } from "./kotlin/index.js";
import { swiftDeadAbstractionDetector, swiftDuplicateLogicDetector, swiftLargeFunctionDetector, swiftTodoCommentDetector } from "./swift/index.js";
import { largeComponentDetector } from "./largeComponent.js";
import { largeFunctionDetector } from "./largeFunction.js";
import { namingDriftDetector } from "./namingDrift.js";
import { propDrillingDetector } from "./propDrilling.js";
import {
  pythonComplexControlFlowDetector,
  pythonDeadAbstractionDetector,
  pythonDuplicateLogicDetector,
  pythonLargeFunctionDetector,
  pythonRouteSprawlDetector,
  pythonTodoCommentDetector,
} from "./python/index.js";
import { rnHostForwardingDetector } from "./rnHostForwarding.js";
import { routeHandlerSizeDetector } from "./routeHandlerSize.js";
import { routeSprawlDetector } from "./routeSprawl.js";
import { serverClientBoundaryDetector } from "./serverClientBoundary.js";
import { stateSprawlDetector } from "./stateSprawl.js";
import { storyOnlyComponentDetector } from "./storyOnlyComponent.js";
import { svelteDuplicateLogicDetector, svelteLargeScriptDetector, svelteTodoCommentDetector } from "./svelte/index.js";
import { testDuplicationDetector } from "./testDuplication.js";
import { todoCommentDetector } from "./todoComment.js";
import { vueDuplicateLogicDetector, vueLargeScriptDetector, vueTodoCommentDetector } from "./vue/index.js";
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
  testDuplicationDetector,
  duplicatedLiteralDetector,
  importCycleDetector,
  complexControlFlowDetector,
  configDriftDetector,
  deadAbstractionDetector,
  propDrillingDetector,
  todoCommentDetector,
  namingDriftDetector,
  barrelFileDetector,
  weakTestBoundaryDetector,
  apiSurfaceSprawlDetector,
  storyOnlyComponentDetector,
  pythonTodoCommentDetector,
  pythonLargeFunctionDetector,
  pythonComplexControlFlowDetector,
  pythonDuplicateLogicDetector,
  pythonDeadAbstractionDetector,
  pythonRouteSprawlDetector,
  vueTodoCommentDetector,
  vueLargeScriptDetector,
  vueDuplicateLogicDetector,
  svelteTodoCommentDetector,
  svelteLargeScriptDetector,
  svelteDuplicateLogicDetector,
  kotlinTodoCommentDetector,
  kotlinLargeFunctionDetector,
  kotlinDuplicateLogicDetector,
  kotlinDeadAbstractionDetector,
  swiftTodoCommentDetector,
  swiftLargeFunctionDetector,
  swiftDuplicateLogicDetector,
  swiftDeadAbstractionDetector,
  composeLargeComposableDetector,
  composeStateHoistingDetector,
];

export const detectorIds = allDetectors.map((detector) => detector.id);
