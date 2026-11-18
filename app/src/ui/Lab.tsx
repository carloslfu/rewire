import DismantleStage from "../stage/DismantleStage.tsx";

export { LearnedControl, MoreExperiments, PartControls } from "./PartControls.tsx";

/**
 * The running model beside the questions. The 3D stage is the one drawing of the architecture. Only
 * its Three.js scene is fetched separately: the bench itself, with its named parts, controls and
 * readings, is part of the page, so it is there even when the scene cannot load or WebGL is missing.
 */
export function LabScope() {
  return <DismantleStage />;
}
