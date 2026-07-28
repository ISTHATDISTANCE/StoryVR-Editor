import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinnedObject } from "three/addons/utils/SkeletonUtils.js";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { createGroundMovementCue, normalizeGroundMovementCue } from "./ground-movement-cue.js";
import {
  clampProceduralDynamicsPlan,
  expandProceduralDynamicsInstances,
  proceduralDynamicsPlansForScene,
  sampleProceduralDynamicsTransform,
} from "./procedural-dynamics-runtime.js";
import {
  augmentGltfLoaderWithStoryVrPointClouds,
  updateStoryVrPointCloudEffects,
} from "./point-cloud-runtime.js";

const runtimeUrl = "../discovery/storyvr-runtime.json";
const captureRoot = "../captures/active";
const readerPublicBaseUrl = import.meta.env?.DEV
  ? new URL(/* @vite-ignore */ "../public/", import.meta.url).href
  : new URL(String(import.meta.env?.BASE_URL || "./").replace(/\/?$/, "/"), window.location.href).href;
const DRACO_DECODER_PATH = `${readerPublicBaseUrl.replace(/\/?$/, "/")}draco/gltf/`;
const KTX2_TRANSCODER_PATH = `${readerPublicBaseUrl.replace(/\/?$/, "/")}basis/`;
const XR_CONTROLLER_PROFILE_PATH = `${readerPublicBaseUrl.replace(/\/?$/, "/")}webxr-input-profiles/profiles`;
const SOURCE_FOCUS_DYNAMIC_REFRESH_MS = 100;
const SPATIAL_TEXT_CACHE_LIMIT = 128;
const SPATIAL_TEXT_CLEARANCE_SAMPLES_PER_FRAME = 4;
const SPATIAL_TEXT_CLEARANCE_SAMPLES_PER_XR_FRAME = 2;
const SPATIAL_TEXT_CLEARANCE_TRANSITION_MS = 100;
const SPATIAL_TEXT_CLEARANCE_REVEAL_MS = 120;
const SPATIAL_TEXT_CLEARANCE_INWARD_HYSTERESIS = 0.02;
const CURRENT_SPATIAL_RELATIONS_INFERENCE_VERSION = "per-scene-exact-assets-v3";
const ATTENTION_COMPLETION_DISTANCE_METERS = 3;
const ATTENTION_ARROW_EDGE_NDC = 0.72;
const ATTENTION_ARROW_DISTANCE_METERS = 0.86;
const ATTENTION_ARROW_RADIUS_METERS = 0.12;
const ATTENTION_ARROW_RADIUS_NDC = 0.09;
const ATTENTION_GLOW_OPACITY = 0.14;
const ATTENTION_ARROW_DIRECTION_RESPONSE = 10;
const ATTENTION_ARROW_MAX_ANGULAR_SPEED_RADIANS_PER_SECOND = Math.PI * 3;
const XR_FRAMEBUFFER_SCALE_FACTOR = 0.8;
const XR_FIXED_FOVEATION = 1;
const XR_TEXT_PANEL_DEFAULT_HAND = "left";
const XR_TEXT_PANEL_WIDTH = 0.46;
const XR_TEXT_PANEL_HEIGHT = 0.252;
const XR_TEXT_PANEL_RENDER_ORDER = 20_000;
const XR_TEXT_PANEL_RAY_LENGTH = 3.2;
const XR_RESERVED_CONTROLLER_CONTROLS = new Set(["trigger", "grip"]);
const XR_GAMEPAD_BUTTON_PRESS_THRESHOLD = 0.72;
const XR_GAMEPAD_BUTTON_RELEASE_THRESHOLD = 0.45;
const XR_THUMBSTICK_PRESS_THRESHOLD = 0.72;
const XR_THUMBSTICK_RELEASE_THRESHOLD = 0.45;
const DESKTOP_READER_MOVE_SPEED_METERS_PER_SECOND = 2.8;
const DEFAULT_LOCOMOTION_DISTANCE_METERS = 0.68;
const DEFAULT_LOCOMOTION_DWELL_SECONDS = 1.25;
const DEFAULT_DIRECT_POSITION_TOLERANCE_METERS = 0.12;
const DEFAULT_DIRECT_ROTATION_TOLERANCE_DEGREES = 12;
const DEFAULT_DIRECT_SCALE_TOLERANCE_RATIO = 0.12;
const ELASTIC_DRAG_MIN_SPEED_METERS_PER_SECOND = 0.35;
const ELASTIC_DRAG_MAX_SPEED_METERS_PER_SECOND = 1.5;
const ELASTIC_DRAG_MAX_POSITION_GAIN = 4;
const ELASTIC_DRAG_MIN_SAMPLE_DISTANCE_METERS = 0.002;
const ELASTIC_DRAG_MAX_SAMPLE_DISTANCE_METERS = 0.2;
const ELASTIC_DRAG_MAX_SAMPLE_SECONDS = 0.12;
const ELASTIC_DRAG_INERTIA_SECONDS = 0.09;
const ELASTIC_DRAG_MAX_INERTIA_SPEED_METERS_PER_SECOND = 3;
const DIRECT_GHOST_OPACITY = 0.32;
const DIRECT_GHOST_VELOCITY_METERS_PER_SECOND = 0.75;
const DIRECT_GHOST_MIN_TRAVEL_SECONDS = 0.75;
const DIRECT_GHOST_MAX_TRAVEL_SECONDS = 4.5;
const DIRECT_GHOST_DESTINATION_HOLD_SECONDS = 3;
const DIRECT_GHOST_INACTIVITY_REPLAY_SECONDS = 5;
let sharedDracoLoader = null;
let sharedKtx2Loader = null;

function createGltfLoader() {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getSharedDracoLoader());
  loader.setKTX2Loader(getSharedKtx2Loader());
  loader.setMeshoptDecoder(MeshoptDecoder);
  return augmentGltfLoaderWithStoryVrPointClouds(loader, {
    THREE,
    effects: () => runtimePointCloudEffects,
    pointCloudUrlForEffect: (effect) => {
      const localPath = String(effect?.pointCloud?.path || "").trim();
      return localPath ? `${captureRoot}/${localPath}` : String(effect?.pointCloud?.url || "").trim();
    },
    onDiagnostic: (error, effect) => {
      console.warn(`StoryVR point-cloud companion ${effect?.id || "unknown"} was skipped: ${error.message}`);
    },
  });
}

function getSharedDracoLoader() {
  if (!sharedDracoLoader) {
    sharedDracoLoader = new DRACOLoader();
    sharedDracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    sharedDracoLoader.setWorkerLimit(2);
  }
  return sharedDracoLoader;
}

function getSharedKtx2Loader() {
  if (!sharedKtx2Loader) {
    sharedKtx2Loader = new KTX2Loader();
    sharedKtx2Loader.setTranscoderPath(KTX2_TRANSCODER_PATH);
    sharedKtx2Loader.detectSupport(renderer);
  }
  return sharedKtx2Loader;
}

const stage = document.querySelector("#stage");
const storyTitle = document.querySelector("#story-title");
const decisionRow = document.querySelector("#decision-row");
const beatProgress = document.querySelector("#beat-progress");
const beatTitle = document.querySelector("#beat-title");
const beatText = document.querySelector("#beat-text");
const variantControls = document.querySelector("#variant-controls");
const readerPanel = document.querySelector(".reader-panel");
const readerPanelToggle = document.querySelector("#reader-panel-toggle");
const beatStrip = document.querySelector("#beat-strip");
const status = document.querySelector("#runtime-status");
const environmentInfo = document.querySelector("#environment-info");
const prevButton = document.querySelector("#prev-beat");
const nextButton = document.querySelector("#next-beat");
const xrButtonSlot = document.querySelector("#xr-button-slot");

let runtime;
try {
  runtime = await loadRuntime();
} catch (error) {
  status.textContent = error.message;
  throw error;
}

const beats = runtime.contentUnits || [];
const runtimePointCloudEffects = Array.isArray(runtime.pointCloudEffects) ? runtime.pointCloudEffects : [];
const graphBeats = new Map((runtime.sceneTopology?.storyGraph?.beats || []).map((beat) => [beat.id, beat]));
const runtimeHasAuthoredEnvironmentPolicy = hasAuthoredRuntimeEnvironmentPolicy(runtime);
const runtimeEnvironmentAssignments = normalizeRuntimeEnvironmentAssignments(
  runtime.environmentEnhancement,
  runtime.provenance?.decisions?.["environment-enhancement"],
);
const finalTuning = finalTuningFromRuntime(runtime);
const performanceOptimization = normalizeRuntimePerformanceOptimization(runtime.performanceOptimization);
const assetTopologyOption = runtime.provenance?.decisions?.["asset-topology"]?.option || {};
const dynamicGeometryOption = runtime.provenance?.decisions?.["dynamic-geometry"]?.option || {};
const runtimeTopologyKind = topologyKindFromLabel(assetTopologyOption.label);
const runtimeDynamicGeometryKind = dynamicGeometryKindFromLabel(dynamicGeometryOption.label);
const dynamicGeometryEnabled = runtimeDynamicGeometryKind !== "none";
const runtimeProceduralDynamics = runtime.proceduralDynamics || null;
const hasSourceMotionLinking = Boolean(runtime.sourceMotionLinking && typeof runtime.sourceMotionLinking === "object");
const sourceMotionTracks = normalizeSourceMotionTracks(runtime.sourceMotionLinking);
const sourceMotionPlaybackAssets = normalizeSourceMotionPlayback(
  runtime.sourceMotionPlayback || runtime.sourceMotionLinking?.playback || null,
);
const sourcePartStates = Array.isArray(runtime.sourcePartStates?.resolvedStates) && runtime.sourcePartStates.resolvedStates.length
  ? runtime.sourcePartStates.resolvedStates
  : Array.isArray(runtime.sourcePartStates?.states) ? runtime.sourcePartStates.states : [];
const sourceSpatialCues = normalizeRuntimeSourceSpatialCues(runtime.sourceSpatialCues);
const runtimeSpatialRelations = normalizeRuntimeSpatialRelations(
  runtime.spatialRelations,
  runtime.provenance?.decisions?.["spatial-relations"],
);
const runtimeAttentionGuidance = normalizeRuntimeAttentionGuidance(
  runtime.attentionGuidance,
  runtime.provenance?.decisions?.["attention-guidance"],
);
const fallbackReaderViewpoint = topologyViewpointKind({
  viewpoint: runtimeSpatialRelations.viewpoint || assetTopologyOption.viewpoint,
});
const runtimeSpatialTraversal = normalizeRuntimeSpatialTraversal(runtime.interactions?.spatialTraversal, runtime.timeline);
const runtimeVariantGroups = normalizeRuntimeVariantGroups(
  runtime.variantGroups || runtime.interactions?.variantGroups || runtime.sceneTopology?.storyGraph?.variantGroups,
);
const runtimeInteractionControl = normalizeRuntimeInteractionControl(runtime.interactions, runtime.timeline, beats);
const runtimeProgressionRoutes = normalizeRuntimeProgressionRoutes(
  runtime.sceneTopology?.storyGraph?.edges,
  runtimeInteractionControl.routes,
  sourceMotionTracks,
);
const runtimeVariantGroupByBeatId = new Map(runtimeVariantGroups.map((group) => [group.beatId, group]));
const runtimeVariantInteractionControlByBeat = normalizeRuntimeVariantInteractionControl(
  runtime.interactions?.variantInteractionControlByBeat,
  runtimeVariantGroups,
);
const runtimeVariantInteractionByBeatId = new Map(runtimeVariantInteractionControlByBeat.map((record) => [record.beatId, record]));
const runtimeVariantInteractionByGroupId = new Map(runtimeVariantInteractionControlByBeat.map((record) => [record.variantGroupId, record]));
const runtimeVariantInteractionControlByEdge = normalizeRuntimeVariantInteractionControlByEdge(
  runtime.interactions?.variantInteractionControlByEdge,
  runtime.sceneTopology?.storyGraph?.edges,
  runtimeVariantGroups,
  runtimeVariantInteractionControlByBeat,
);
const runtimeInBeatInteractions = normalizeRuntimeInBeatInteractions(runtime.interactions?.inBeatInteractions);
const activeVariantOptionByGroupId = new Map();
const runtimeTextComfort = normalizeRuntimeTextComfort(runtime.textComfort, runtime.provenance?.decisions?.["text-comfort"]);
const modelCache = new Map();
const imageTextureCache = new Map();
const spatialTextClearanceCache = new Map();
const spatialTextFocusCache = new Map();
const spatialTextModelFocusCache = new Map();
const spatialTextCollisionBoundsByMesh = new WeakMap();
const spatialTextCollisionEntryByMesh = new WeakMap();
const spatialTextFocusRaycaster = new THREE.Raycaster();
const spatialTextFocusOrigin = new THREE.Vector3();
const spatialTextFocusDirection = new THREE.Vector3();
const spatialTextFocusCandidates = [];
const spatialTextFocusHits = [];
const spatialTextActiveModelBounds = new THREE.Box3();
const spatialTextClearanceRaycaster = new THREE.Raycaster();
const spatialTextClearancePoint = new THREE.Vector3();
const spatialTextClearanceDirection = new THREE.Vector3();
const spatialTextClearanceCandidates = [];
const spatialTextClearanceHits = [];
const spatialTextOrientationTarget = new THREE.Vector3();
const spatialTextPanelWorldPosition = new THREE.Vector3();
const spatialTextCameraPosition = new THREE.Vector3();
const completedRuntimeAttentionKeys = new Set();
const activeRuntimeAttentionTargets = [];
const runtimeAttentionProjectionMatrix = new THREE.Matrix4();
const runtimeAttentionFrustum = new THREE.Frustum();
const runtimeAttentionViewerPosition = new THREE.Vector3();
const runtimeAttentionArrowTarget = new THREE.Vector3();
const runtimeAttentionArrowLocalTarget = new THREE.Vector3();
const runtimeAttentionArrowNdc = new THREE.Vector3();
const runtimeAttentionArrowWorld = new THREE.Vector3();
const runtimeAttentionArrowCameraPosition = new THREE.Vector3();
const runtimeAttentionArrowCameraQuaternion = new THREE.Quaternion();
const runtimeAttentionMeshBounds = new THREE.Box3();
const proceduralDynamicsUpAxis = new THREE.Vector3(0, 1, 0);
let spatialTextCollisionProxyCache = { root: null, checkedAt: -Infinity, entries: [] };
let lastFrameTime = performance.now();
let elapsedSeconds = 0;

let activeIndex = firstTraversalBeatIndex();
const runtimeProgressionRouteHistory = new Map();
let activeModel = null;
let activeModelAsset = null;
let activeModelSpatialEntity = null;
let activeModelAnimations = [];
let activeSourceAnimation = null;
let activeSourcePresentationSignature = "";
const activeSupplementalModelEntries = [];
const activeSpatialImageEntries = [];
const activeProceduralDynamicsEntries = [];
let activeSceneLoadRevision = 0;
let habitat = null;
let spatialTextPanel = null;
let spatialTextPlacement = null;
let activeAttentionGuidance = null;
let environmentLoaded = false;
let environmentTexture = null;
let groundMovementCue = null;
let activeRuntimeEnvironment = null;
let activeRuntimeEnvironmentSignature = "";
let physicalTraversalEnteredAt = null;
let physicalTraversalAdvancing = false;
let controllerAdvancePending = false;
let directManipulationAdvancePending = false;
let xrDirectManipulationGrab = null;
let xrDirectManipulationScale = null;
const activePhysicalTraversalZones = [];
const physicalTraversalEnteredByZone = new Map();
const activeRuntimeInBeatTargets = [];
const runtimeInteractionEntryByRoot = new WeakMap();
const activeRuntimeDirectInteractions = [];
const activeRuntimeDirectCues = [];
const xrTextPanelControllers = new Map();
const xrTextPanelControllersByHand = new Map();
let xrControllerConnectionRevision = 0;
const xrTextPanelConsumedSelect = new WeakSet();
const xrTextPanelRaycaster = new THREE.Raycaster();
const xrTextPanelRayRotation = new THREE.Matrix4();
const xrControllerModelFactory = new XRControllerModelFactory();
xrControllerModelFactory.setPath(XR_CONTROLLER_PROFILE_PATH);
let xrTextPanelPreferredHand = XR_TEXT_PANEL_DEFAULT_HAND;
let xrTextPanelAttachedEntry = null;
let xrTextPanelGrabEntry = null;
let xrTextPanelGrabInput = null;
let xrTextPanelScrollGesture = null;
let textPanelMinimized = false;
let readerPanelDrag = null;
let suppressReaderPanelToggleClick = false;

storyTitle.textContent = runtime.title || runtime.slug || "Compiled StoryVR";
decisionRow.innerHTML = designChips().map((label) => `<span>${escapeHtml(label)}</span>`).join("");

const renderer = new THREE.WebGLRenderer({
  antialias: performanceOptimization.settings.antialias,
  alpha: true,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, performanceOptimization.settings.desktopPixelRatioCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = performanceOptimization.settings.desktopShadows;
renderer.xr.enabled = true;
renderer.xr.setFramebufferScaleFactor(performanceOptimization.settings.xrFramebufferScaleFactor);
renderer.xr.setFoveation(performanceOptimization.settings.xrFixedFoveation);
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute(
  "aria-label",
  "Reader view. Drag to look around. Focus the scene and use W A S D to move.",
);
renderer.domElement.title = "Drag to look around · Click the scene, then use WASD to move";
stage.appendChild(renderer.domElement);
if (performanceOptimization.status === "applied") {
  console.info(`[StoryVR performance] Codex ${performanceOptimization.profile} profile applied.`, performanceOptimization.settings);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080a08);
scene.fog = null;

const readerRig = new THREE.Group();
readerRig.name = "storyvr-reader-rig";
scene.add(readerRig);
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 1.55, 5.2);
readerRig.add(camera);
const xrEntryWorldPosition = new THREE.Vector3();
const xrEntryWorldQuaternion = new THREE.Quaternion();
const xrEntryLocalPosition = new THREE.Vector3();
const xrEntryLocalQuaternion = new THREE.Quaternion();
const xrEntryEuler = new THREE.Euler(0, 0, 0, "YXZ");
let xrEntryPosePending = false;
let runtimeReaderPoseInitialized = false;
const desktopReaderMovementKeys = new Set();
const desktopReaderLookPosition = new THREE.Vector3();
const desktopReaderLookDirection = new THREE.Vector3();
const desktopReaderMovement = new THREE.Vector3();
const desktopReaderForward = new THREE.Vector3();
const desktopReaderRight = new THREE.Vector3();
let desktopReaderLookDistance = 1;
let desktopReaderLookInitialized = false;

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.25, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.enableZoom = false;
controls.maxDistance = 9;
controls.minDistance = 1.8;
configureCameraForTopology();
resetDesktopReaderLookAnchor();
const desktopShadowMapEnabled = renderer.shadowMap.enabled;
renderer.xr.addEventListener("sessionstart", () => {
  captureXrEntryPose();
  desktopReaderMovementKeys.clear();
  controls.enabled = false;
  renderer.shadowMap.enabled = false;
  setSharedTimelineAnnotationsHidden(activeSourceAnimation, true);
  attachSpatialTextPanelToPreferredHand();
  updateSpatialTextPanelPose();
});
renderer.xr.addEventListener("sessionend", () => {
  xrEntryPosePending = false;
  cancelXrDirectManipulation();
  xrTextPanelGrabEntry = null;
  xrTextPanelGrabInput = null;
  xrTextPanelScrollGesture = null;
  if (spatialTextPanel) spatialTextPanel.visible = false;
  controls.enabled = true;
  resetDesktopReaderLookAnchor();
  renderer.shadowMap.enabled = desktopShadowMapEnabled;
  renderer.shadowMap.needsUpdate = true;
  setSharedTimelineAnnotationsHidden(activeSourceAnimation, false);
});

function resetDesktopReaderLookAnchor() {
  if (renderer.xr.isPresenting) return false;
  desktopReaderLookPosition.copy(camera.position);
  camera.getWorldDirection(desktopReaderLookDirection);
  desktopReaderLookDistance = Math.max(camera.position.distanceTo(controls.target), 0.35);
  desktopReaderLookInitialized = true;
  return true;
}

function stabilizeDesktopReaderLook() {
  if (renderer.xr.isPresenting) return false;
  if (!desktopReaderLookInitialized) return resetDesktopReaderLookAnchor();
  camera.getWorldDirection(desktopReaderLookDirection);
  camera.position.copy(desktopReaderLookPosition);
  controls.target.copy(desktopReaderLookPosition).addScaledVector(
    desktopReaderLookDirection,
    desktopReaderLookDistance,
  );
  camera.lookAt(controls.target);
  camera.updateMatrixWorld(true);
  return true;
}

function updateDesktopKeyboardMovement(deltaSeconds) {
  if (renderer.xr.isPresenting || !desktopReaderMovementKeys.size) return false;
  camera.getWorldDirection(desktopReaderForward);
  desktopReaderForward.y = 0;
  if (desktopReaderForward.lengthSq() === 0) return false;
  desktopReaderForward.normalize();
  desktopReaderRight.crossVectors(desktopReaderForward, camera.up).normalize();
  desktopReaderMovement.set(0, 0, 0);
  if (desktopReaderMovementKeys.has("w")) desktopReaderMovement.add(desktopReaderForward);
  if (desktopReaderMovementKeys.has("s")) desktopReaderMovement.sub(desktopReaderForward);
  if (desktopReaderMovementKeys.has("d")) desktopReaderMovement.add(desktopReaderRight);
  if (desktopReaderMovementKeys.has("a")) desktopReaderMovement.sub(desktopReaderRight);
  if (desktopReaderMovement.lengthSq() === 0) return false;
  desktopReaderMovement.normalize().multiplyScalar(
    Math.max(0, Number(deltaSeconds) || 0) * DESKTOP_READER_MOVE_SPEED_METERS_PER_SECOND,
  );
  camera.position.add(desktopReaderMovement);
  controls.target.add(desktopReaderMovement);
  desktopReaderLookPosition.add(desktopReaderMovement);
  return true;
}

function captureXrEntryPose() {
  camera.updateWorldMatrix(true, false);
  camera.getWorldPosition(xrEntryWorldPosition);
  camera.getWorldQuaternion(xrEntryWorldQuaternion);
  const station = authoredReaderStationForBeat(beats[activeIndex], activeIndex);
  if (station?.coordinateSpace !== "reader") {
    const stationPosition = worldReaderPositionForStation(station);
    if (stationPosition) {
      if (station.readerEntityId) xrEntryWorldPosition.copy(stationPosition);
      else {
        xrEntryWorldPosition.x = stationPosition.x;
        xrEntryWorldPosition.z = stationPosition.z;
      }
    }
    if (station.readerEntityId) {
      const stationQuaternion = worldReaderQuaternionForStation(station);
      if (stationQuaternion) xrEntryWorldQuaternion.copy(stationQuaternion);
    }
  }
  xrEntryPosePending = true;
}

function alignXrEntryPose(xrFrame) {
  if (!xrEntryPosePending || !xrFrame) return;
  const referenceSpace = renderer.xr.getReferenceSpace();
  if (!referenceSpace) return;
  const pose = xrFrame.getViewerPose(referenceSpace);
  if (!pose) return;

  const { position, orientation } = pose.transform;
  xrEntryLocalPosition.set(position.x, position.y, position.z);
  xrEntryLocalQuaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
  const desiredYaw = xrEntryEuler.setFromQuaternion(xrEntryWorldQuaternion, "YXZ").y;
  const viewerYaw = xrEntryEuler.setFromQuaternion(xrEntryLocalQuaternion, "YXZ").y;
  readerRig.rotation.set(0, desiredYaw - viewerYaw, 0);
  xrEntryLocalPosition.applyQuaternion(readerRig.quaternion);
  readerRig.position.copy(xrEntryWorldPosition).sub(xrEntryLocalPosition);
  readerRig.updateMatrixWorld(true);
  xrEntryPosePending = false;
}

scene.add(new THREE.HemisphereLight(0xd9fff5, 0x19120c, 1.25));
const keyLight = new THREE.DirectionalLight(0xffe1b8, 3.4);
keyLight.position.set(-3.8, 5.4, 3.2);
keyLight.castShadow = true;
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x6ed8c2, 2.4, 12);
rimLight.position.set(3.5, 2.2, -3.5);
scene.add(rimLight);

const modelRoot = new THREE.Group();
modelRoot.position.set(0, 1.18, 0);
scene.add(modelRoot);
const modelAuthorTransformRoot = new THREE.Group();
modelAuthorTransformRoot.name = "storyvr-spatial-relations-author-transform";
modelRoot.add(modelAuthorTransformRoot);

const environmentRoot = new THREE.Group();
environmentRoot.name = "storyvr-environment-enhancement";
scene.add(environmentRoot);
const neutralEnvironmentRoot = createRoom();
neutralEnvironmentRoot.name = "storyvr-neutral-environment";
const traversalDestinationRoot = new THREE.Group();
traversalDestinationRoot.name = "storyvr-spatial-traversal-destination";
scene.add(traversalDestinationRoot);
const directManipulationCueRoot = new THREE.Group();
directManipulationCueRoot.name = "storyvr-direct-manipulation-cues";
scene.add(directManipulationCueRoot);

const xrButton = VRButton.createButton(renderer);
Object.assign(xrButton.style, {
  position: "static",
  bottom: "auto",
  left: "auto",
  right: "auto",
  transform: "none",
});
xrButtonSlot.appendChild(xrButton);
configureXrInteractionControllers();

prevButton.addEventListener("click", () => navigateInteraction(-1));
nextButton.addEventListener("click", () => navigateInteraction(1));
readerPanelToggle?.addEventListener("click", (event) => {
  if (suppressReaderPanelToggleClick) {
    suppressReaderPanelToggleClick = false;
    event.preventDefault();
    return;
  }
  setTextPanelMinimized(!textPanelMinimized);
});
configureReaderPanelMouseDragging();
window.addEventListener("resize", resize);
window.addEventListener("pagehide", disposeRuntimeEnvironmentEnhancement, { once: true });
renderer.domElement.addEventListener("pointerdown", () => renderer.domElement.focus());
renderer.domElement.addEventListener("blur", () => desktopReaderMovementKeys.clear());
window.addEventListener("blur", () => desktopReaderMovementKeys.clear());
window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") navigateInteraction(-1);
  if (event.key === "ArrowRight") navigateInteraction(1);
  const key = event.key.toLowerCase();
  if (
    !renderer.xr.isPresenting
    && document.activeElement === renderer.domElement
    && ["w", "a", "s", "d"].includes(key)
  ) {
    event.preventDefault();
    desktopReaderMovementKeys.add(key);
  }
});
window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  if (["w", "a", "s", "d"].includes(key)) desktopReaderMovementKeys.delete(key);
});

buildBeatStrip();
configureTraversalControls();
if (beats.length) {
  await setBeat(activeIndex);
} else {
  beatProgress.textContent = "No beats in compiled runtime";
  beatTitle.textContent = "No story beats";
  beatText.textContent = "Compile again after the source graph contains story beats.";
  prevButton.disabled = true;
  nextButton.disabled = true;
}
renderer.setAnimationLoop(render);

async function loadRuntime() {
  const response = await fetch(runtimeUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${runtimeUrl}`);
  return response.json();
}

function hasAuthoredRuntimeEnvironmentPolicy(runtimeValue) {
  const decision = runtimeValue?.provenance?.decisions?.["environment-enhancement"];
  return Boolean(
    (runtimeValue?.environmentEnhancement && typeof runtimeValue.environmentEnhancement === "object")
    || (decision?.option && typeof decision.option === "object")
  );
}

function normalizeRuntimeEnvironmentAssignments(value, decision) {
  const source = value && typeof value === "object"
    ? value
    : decision?.option?.environmentEnhancement && typeof decision.option.environmentEnhancement === "object"
      ? decision.option.environmentEnhancement
      : null;
  if (!source) {
    return {
      schemaVersion: "storyvr-environment-enhancement-assignments/v2",
      defaultEnvironment: null,
      assignmentsByBeat: {},
    };
  }
  if (source.schemaVersion !== "storyvr-environment-enhancement-assignments/v2") {
    return {
      schemaVersion: "storyvr-environment-enhancement-assignments/v2",
      defaultEnvironment: normalizeRuntimeEnvironmentEnhancement(source, decision),
      assignmentsByBeat: {},
    };
  }
  const assignmentsByBeat = {};
  const rawAssignments = source.assignmentsByBeat && typeof source.assignmentsByBeat === "object"
    ? source.assignmentsByBeat
    : {};
  for (const [beatId, environment] of Object.entries(rawAssignments)) {
    const normalizedBeatId = String(beatId || "").trim();
    if (!normalizedBeatId) continue;
    assignmentsByBeat[normalizedBeatId] = environment === null
      ? null
      : normalizeRuntimeEnvironmentEnhancement(environment, decision);
  }
  return {
    schemaVersion: "storyvr-environment-enhancement-assignments/v2",
    defaultEnvironment: source.defaultEnvironment === null
      ? null
      : normalizeRuntimeEnvironmentEnhancement(source.defaultEnvironment, decision),
    assignmentsByBeat,
  };
}

function normalizeRuntimeEnvironmentEnhancement(value, decision = null) {
  const source = value && typeof value === "object" ? value : null;
  if (!source) return null;
  const asset = source.asset && typeof source.asset === "object" ? source.asset : {};
  const publicPath = String(asset.publicPath || asset.path || "").replace(/^\/+/, "").trim();
  if (!publicPath) return null;
  const format = String(asset.format || publicPath.split(".").pop() || "").toLowerCase();
  const mediaType = String(asset.mediaType || "").toLowerCase();
  const panorama = ["hdr", "exr", "png"].includes(format)
    || mediaType.includes("radiance")
    || mediaType.includes("exr")
    || mediaType === "image/png";
  const selectedSource = source.selectedSource && typeof source.selectedSource === "object"
    ? source.selectedSource.candidate || source.selectedSource
    : {};
  const sourceEvidence = {
    ...selectedSource,
    ...(source.source && typeof source.source === "object" ? source.source : {}),
    ...(source.provenance && typeof source.provenance === "object" ? source.provenance : {}),
  };
  const position = Array.isArray(source.transform?.position) ? source.transform.position : [];
  return {
    schemaVersion: String(source.schemaVersion || "storyvr-environment-enhancement-runtime/v1"),
    kind: panorama ? "panorama" : "model",
    asset: { ...asset, publicPath, format, mediaType },
    transform: {
      position: [0, 1, 2].map((index) => finiteRuntimeNumber(position[index], 0)),
      rotationY: finiteRuntimeNumber(source.transform?.rotationY, 0),
      scale: Math.max(0.001, finiteRuntimeNumber(source.transform?.scale, 1)),
    },
    rendering: {
      exposure: Math.max(0.01, finiteRuntimeNumber(source.rendering?.exposure, 1)),
      fogColor: runtimeColor(source.rendering?.fogColor, "#dce8e2"),
      fogDensity: Math.max(0, finiteRuntimeNumber(source.rendering?.fogDensity, 0)),
      backgroundMode: runtimeBackgroundMode(source.rendering?.backgroundMode),
    },
    movementCue: normalizeGroundMovementCue(source.movementCue),
    provenance: {
      provider: String(sourceEvidence.provider || "").trim(),
      title: String(sourceEvidence.title || decision?.option?.label || "Environment asset").trim(),
      attribution: String(sourceEvidence.attribution || sourceEvidence.license?.attribution || "").trim(),
      sourceUrl: safeRuntimeHttpUrl(sourceEvidence.sourceUrl || sourceEvidence.sourcePageUrl || sourceEvidence.pageUrl),
      license: sourceEvidence.license || null,
    },
  };
}

function runtimeEnvironmentEnhancementForBeat(beat) {
  const beatId = String(beat?.id || beat?.unitId || "").trim();
  if (beatId && Object.hasOwn(runtimeEnvironmentAssignments.assignmentsByBeat, beatId)) {
    return runtimeEnvironmentAssignments.assignmentsByBeat[beatId];
  }
  return runtimeEnvironmentAssignments.defaultEnvironment;
}

function runtimeEnvironmentEnhancementSignature(environment) {
  return environment ? JSON.stringify(environment) : "";
}

async function switchRuntimeEnvironmentEnhancement(beat, loadRevision) {
  const nextEnvironment = runtimeEnvironmentEnhancementForBeat(beat);
  const nextSignature = runtimeEnvironmentEnhancementSignature(nextEnvironment);
  if (
    nextSignature === activeRuntimeEnvironmentSignature
    && ((nextEnvironment && environmentLoaded) || (!nextEnvironment && !environmentLoaded))
  ) {
    activeRuntimeEnvironment = nextEnvironment;
    neutralEnvironmentRoot.visible = !environmentLoaded;
    renderEnvironmentInformation(
      environmentLoaded
        ? { loaded: true, reason: null }
        : { loaded: false, reason: "not-authored" },
      nextEnvironment,
    );
    return { loaded: environmentLoaded, reason: nextEnvironment ? null : "not-authored" };
  }

  clearRuntimeEnvironmentEnhancement();
  activeRuntimeEnvironment = nextEnvironment;
  activeRuntimeEnvironmentSignature = nextSignature;
  neutralEnvironmentRoot.visible = true;
  if (!nextEnvironment) {
    const result = { loaded: false, reason: "not-authored" };
    renderEnvironmentInformation(result, null);
    return result;
  }

  renderEnvironmentInformation({
    loaded: false,
    reason: "loading",
    error: "loading the selected surrounding",
  }, nextEnvironment);
  const result = await loadRuntimeEnvironmentEnhancement(nextEnvironment, loadRevision);
  if (result.reason === "stale") return result;
  neutralEnvironmentRoot.visible = !result.loaded;
  renderEnvironmentInformation(result, nextEnvironment);
  return result;
}

async function loadRuntimeEnvironmentEnhancement(runtimeEnvironment, loadRevision = activeSceneLoadRevision) {
  if (!runtimeEnvironment) return { loaded: false, reason: "not-authored" };
  const assetUrl = runtimeEnvironmentAssetUrl(runtimeEnvironment.asset.publicPath);
  let loadedTexture = null;
  let loadedModel = null;
  try {
    if (runtimeEnvironment.kind === "panorama") {
      const format = runtimeEnvironment.asset.format;
      const loader = format === "exr"
        ? new EXRLoader()
        : format === "png"
          ? new THREE.TextureLoader()
          : new HDRLoader();
      loadedTexture = await loader.loadAsync(assetUrl);
      if (format === "png") loadedTexture.colorSpace = THREE.SRGBColorSpace;
      loadedTexture.mapping = THREE.EquirectangularReflectionMapping;
    } else {
      const gltf = await createGltfLoader().loadAsync(assetUrl);
      loadedModel = gltf.scene;
      loadedModel.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = Boolean(node.castShadow);
          node.receiveShadow = true;
        }
        if (node.isCamera) node.visible = false;
      });
    }
    if (loadRevision !== activeSceneLoadRevision) {
      loadedTexture?.dispose();
      disposeRuntimeEnvironmentObject(loadedModel);
      return { loaded: false, reason: "stale" };
    }
    environmentTexture = loadedTexture;
    if (loadedModel) environmentRoot.add(loadedModel);
    if (loadedModel) expandCameraRangeForEnvironment(environmentRoot);
    applyRuntimeEnvironmentEnhancement(runtimeEnvironment);
    environmentLoaded = true;
    if (runtimeEnvironment.kind === "panorama") installRuntimeGroundMovementCue(runtimeEnvironment);
    return { loaded: true, reason: null };
  } catch (error) {
    loadedModel?.removeFromParent();
    loadedTexture?.dispose();
    if (environmentTexture === loadedTexture) environmentTexture = null;
    disposeRuntimeEnvironmentObject(loadedModel);
    if (loadRevision !== activeSceneLoadRevision) {
      return { loaded: false, reason: "stale" };
    }
    environmentLoaded = false;
    return {
      loaded: false,
      reason: "load-failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function installRuntimeGroundMovementCue(runtimeEnvironment) {
  if (groundMovementCue || runtimeEnvironment?.movementCue?.enabled !== true) return;
  try {
    const movementCue = normalizeGroundMovementCue({
      ...runtimeEnvironment.movementCue,
      rotationY: runtimeEnvironment.transform.rotationY,
    });
    const textureUrl = movementCue.texture?.publicPath
      ? runtimeEnvironmentAssetUrl(movementCue.texture.publicPath)
      : null;
    const cue = createGroundMovementCue(movementCue, { renderer, textureUrl });
    if (!cue) return;
    scene.add(cue.mesh);
    groundMovementCue = cue;
  } catch (error) {
    console.warn("StoryVR could not create the ground movement cue.", error);
  }
}

function disposeRuntimeGroundMovementCue() {
  groundMovementCue?.dispose();
  groundMovementCue = null;
}

function applyRuntimeEnvironmentEnhancement(runtimeEnvironment) {
  if (!runtimeEnvironment) return;
  const { transform, rendering } = runtimeEnvironment;
  environmentRoot.position.fromArray(transform.position);
  environmentRoot.rotation.set(0, transform.rotationY, 0);
  environmentRoot.scale.setScalar(transform.scale);
  environmentRoot.updateMatrixWorld(true);
  renderer.toneMappingExposure = rendering.exposure;
  scene.environment = environmentTexture;
  scene.environmentRotation.y = transform.rotationY;
  scene.backgroundRotation.y = transform.rotationY;
  scene.fog = rendering.fogDensity > 0
    ? new THREE.FogExp2(new THREE.Color(rendering.fogColor), rendering.fogDensity)
    : null;
  if (rendering.backgroundMode === "asset" && environmentTexture) {
    scene.background = environmentTexture;
  } else if (rendering.backgroundMode === "transparent") {
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
  } else {
    scene.background = new THREE.Color(rendering.fogColor);
    renderer.setClearAlpha(1);
  }
}

function clearRuntimeEnvironmentEnhancement() {
  disposeRuntimeGroundMovementCue();
  scene.environment = null;
  scene.background = new THREE.Color(0x080a08);
  scene.fog = null;
  scene.environmentRotation.y = 0;
  scene.backgroundRotation.y = 0;
  renderer.toneMappingExposure = 1;
  renderer.setClearColor(0x080a08, 1);
  environmentTexture?.dispose();
  environmentTexture = null;
  for (const child of [...environmentRoot.children]) {
    environmentRoot.remove(child);
    disposeRuntimeEnvironmentObject(child);
  }
  environmentRoot.position.set(0, 0, 0);
  environmentRoot.rotation.set(0, 0, 0);
  environmentRoot.scale.setScalar(1);
  environmentLoaded = false;
}

function sourcePlaybackPresentationBackground(contract) {
  const value = contract?.presentation?.backgroundColor;
  if (Array.isArray(value) && value.length >= 3) {
    const components = value.slice(0, 3).map(Number);
    if (components.every(Number.isFinite)) return new THREE.Color().setRGB(...components);
  }
  const text = String(value || "").trim();
  return text ? new THREE.Color(text) : null;
}

function syncSourcePlaybackPresentation(playback) {
  if (environmentLoaded) {
    activeSourcePresentationSignature = "environment";
    neutralEnvironmentRoot.visible = false;
    if (habitat) habitat.visible = false;
    return;
  }
  const contract = playback?.sharedTimeline ? playback.contract : null;
  const presentation = contract?.presentation && typeof contract.presentation === "object"
    ? contract.presentation
    : null;
  const background = runtimeHasAuthoredEnvironmentPolicy
    ? null
    : sourcePlaybackPresentationBackground(contract);
  const authoredGround = presentation?.authoredGround === true;
  const signature = `${background?.getHexString?.() || "neutral"}:${authoredGround ? "authored-ground" : "fallback-ground"}`;
  neutralEnvironmentRoot.visible = !authoredGround;
  if (habitat) habitat.visible = !authoredGround;
  const expectedBackground = background?.getHexString?.() || "080a08";
  const currentBackground = scene.background?.isColor ? scene.background.getHexString() : "";
  if (activeSourcePresentationSignature === signature && currentBackground === expectedBackground) return;
  activeSourcePresentationSignature = signature;
  if (background) {
    scene.background = background;
    scene.fog = null;
    renderer.setClearColor(background, 1);
  } else {
    scene.background = new THREE.Color(0x080a08);
    scene.fog = null;
    renderer.setClearColor(0x080a08, 1);
  }
}

function disposeRuntimeEnvironmentObject(root) {
  if (!root?.traverse) return;
  root.traverse((node) => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      for (const property of Object.values(material)) {
        if (property?.isTexture) property.dispose();
      }
      material.dispose?.();
    }
  });
}

function disposeRuntimeEnvironmentEnhancement() {
  clearRuntimeEnvironmentEnhancement();
  disposeRuntimeEnvironmentObject(neutralEnvironmentRoot);
  neutralEnvironmentRoot.removeFromParent();
  activeRuntimeEnvironment = null;
  activeRuntimeEnvironmentSignature = "";
}

function expandCameraRangeForEnvironment(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const requiredFar = Math.max(100, center.length() + size.length() * 2.5);
  if (requiredFar <= camera.far) return;
  camera.far = Math.min(requiredFar, 1_000_000);
  camera.updateProjectionMatrix();
}

function runtimeEnvironmentAssetUrl(publicPath) {
  return new URL(String(publicPath || "").replace(/^\/+/, ""), readerPublicBaseUrl).href;
}

function renderEnvironmentInformation(result, runtimeEnvironment = activeRuntimeEnvironment) {
  if (!environmentInfo) return;
  environmentInfo.replaceChildren();
  if (!runtimeEnvironment) {
    environmentInfo.hidden = true;
    return;
  }
  environmentInfo.hidden = false;
  const evidence = runtimeEnvironment.provenance;
  const label = document.createElement("span");
  label.textContent = result.loaded
    ? `Environment: ${evidence.title || "selected surrounding"}`
    : `Environment fallback: ${result.error || "the selected surrounding could not be loaded"}`;
  environmentInfo.append(label);
  const details = [evidence.provider, runtimeLicenseLabel(evidence.license), evidence.attribution].filter(Boolean).join(" · ");
  if (details) environmentInfo.append(document.createTextNode(` — ${details}`));
  if (evidence.sourceUrl) {
    environmentInfo.append(document.createTextNode(" "));
    const link = document.createElement("a");
    link.href = evidence.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Source";
    environmentInfo.append(link);
  }
}

function runtimeLicenseLabel(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value.name || value.label || value.spdx || value.id || "").trim();
}

function finiteRuntimeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function runtimeColor(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function runtimeBackgroundMode(value) {
  const mode = String(value || "asset").toLowerCase();
  return ["asset", "fog-color", "transparent"].includes(mode) ? mode : "asset";
}

function safeRuntimeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeRuntimeSourceSpatialCues(value) {
  const source = value && typeof value === "object" ? value : {};
  const cues = Array.isArray(source.cues)
    ? source.cues
    : (Array.isArray(source.assets) ? source.assets.flatMap((asset) => asset?.cues || []) : []);
  return {
    schemaVersion: String(source.schemaVersion || "storyvr-source-spatial-cues/v1"),
    inferredPath: Boolean(source.inferredPath),
    cues: cues.filter((cue) => cue?.beatId && cue?.assetId),
  };
}

function normalizeRuntimeSpatialRelations(value, decision) {
  const source = value && typeof value === "object"
    ? value
    : decision?.spatialRelations && typeof decision.spatialRelations === "object"
      ? decision.spatialRelations
      : {};
  const entities = spatialEntityIndex(source.entities);
  const resolvedByBeat = source.resolvedByBeat && typeof source.resolvedByBeat === "object" ? source.resolvedByBeat : {};
  const resolvedByVariant = source.resolvedByVariant && typeof source.resolvedByVariant === "object" ? source.resolvedByVariant : {};
  return {
    schemaVersion: String(source.schemaVersion || "storyvr-spatial-relations/v1"),
    inferenceVersion: String(source.inferenceVersion || ""),
    viewpoint: String(source.viewpoint || ""),
    entities,
    resolvedByBeat,
    resolvedByVariant,
    timeline: Array.isArray(source.timeline) ? source.timeline : [],
    inference: source.inference && typeof source.inference === "object" ? source.inference : null,
  };
}

function finiteAttentionPoint(value) {
  const source = Array.isArray(value)
    ? { x: value[0], y: value[1], z: value[2] }
    : value;
  if (!source || typeof source !== "object") return null;
  if (![source.x, source.y, source.z].every((coordinate) => (
    typeof coordinate === "number" && Number.isFinite(coordinate)
  ))) return null;
  const point = {
    x: source.x,
    y: source.y,
    z: source.z,
  };
  return point;
}

function normalizeRuntimeAttentionMarker(value, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const assetId = String(value.assetId || "").trim();
  const position = finiteAttentionPoint(value.position);
  const coordinateSpace = String(value.coordinateSpace || "spatial-scene").trim().toLowerCase();
  if (!assetId || !position || coordinateSpace !== "spatial-scene") return null;
  const inferredPosition = finiteAttentionPoint(value.inferredPosition) || position;
  const confidence = Number(value.confidence);
  const marker = {
    id: String(value.id || `attention-marker-${index + 1}`).trim(),
    assetId,
    coordinateSpace,
    inferredPosition,
    position,
    manual: value.manual === true,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    provenance: value.provenance && typeof value.provenance === "object" && !Array.isArray(value.provenance)
      ? value.provenance
      : {},
  };
  const entityId = String(value.entityId || "").trim();
  const partSelector = String(value.partSelector || "").trim();
  const targetKind = String(value.targetKind || "").trim();
  const renderableName = String(value.renderableName || "").trim();
  if (entityId) marker.entityId = entityId;
  if (partSelector) marker.partSelector = partSelector;
  if (targetKind) marker.targetKind = targetKind;
  if (renderableName) marker.renderableName = renderableName;
  return marker;
}

function attentionSceneRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value.scene && typeof value.scene === "object" && !Array.isArray(value.scene)
    ? value.scene
    : value;
}

function normalizeRuntimeAttentionScene(value, fallbackBeatId = "", fallbackVariantOptionId = "") {
  const source = attentionSceneRecord(value);
  if (!source) return null;
  const beatId = String(source.beatId || source.unitId || fallbackBeatId || "").trim();
  const variantOptionId = String(source.variantOptionId || source.optionId || fallbackVariantOptionId || "").trim();
  const sceneKey = String(
    source.sceneKey
      || (beatId && variantOptionId ? `beat:${beatId}:variant:${variantOptionId}` : beatId ? `beat:${beatId}` : ""),
  ).trim();
  const sourceEvaluation = source.evaluation && typeof source.evaluation === "object" && !Array.isArray(source.evaluation)
    ? source.evaluation
    : {};
  const resolvedCandidateCount = Number(sourceEvaluation.resolvedCandidateCount);
  const rejectedCandidateCount = Number(sourceEvaluation.rejectedCandidateCount);
  return {
    sceneKey,
    beatId,
    ...(variantOptionId ? { variantOptionId } : {}),
    evaluated: source.evaluated === true,
    evaluation: {
      status: String(sourceEvaluation.status || "").trim(),
      resolvedCandidateCount: Number.isFinite(resolvedCandidateCount)
        ? Math.max(0, Math.trunc(resolvedCandidateCount))
        : 0,
      rejectedCandidateCount: Number.isFinite(rejectedCandidateCount)
        ? Math.max(0, Math.trunc(rejectedCandidateCount))
        : 0,
    },
    markers: (Array.isArray(source.markers) ? source.markers : [])
      .map((marker, index) => normalizeRuntimeAttentionMarker(marker, index))
      .filter(Boolean),
  };
}

function normalizeRuntimeAttentionSceneMap(value, keyKind = "beat") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, scene]) => {
    const normalized = normalizeRuntimeAttentionScene(scene, keyKind === "beat" ? key : "");
    return normalized ? [[key, normalized]] : [];
  }));
}

function normalizeRuntimeAttentionReaderGuidance(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source || source.schemaVersion !== "storyvr-attention-reader-guidance/v1") return null;
  const completion = source.completion && typeof source.completion === "object" ? source.completion : {};
  const arrow = source.arrow && typeof source.arrow === "object" ? source.arrow : {};
  const glow = source.glow && typeof source.glow === "object" ? source.glow : {};
  const requestedDistance = Number(completion.distanceMeters);
  const requestedOpacity = Number(glow.opacity);
  return {
    schemaVersion: String(source.schemaVersion || "storyvr-attention-reader-guidance/v1"),
    completion: {
      distanceMeters: Number.isFinite(requestedDistance)
        ? Math.max(0.1, Math.min(100, requestedDistance))
        : ATTENTION_COMPLETION_DISTANCE_METERS,
      distanceMetric: "viewer-to-target-bounds",
      once: completion.once !== false,
      persistence: "story-session",
    },
    arrow: {
      enabled: arrow.enabled !== false,
      visibility: "outside-view-frustum",
      placement: "camera-edge",
    },
    glow: {
      enabled: glow.enabled !== false,
      mode: "subtle-additive-overlay",
      opacity: Number.isFinite(requestedOpacity)
        ? Math.max(0.02, Math.min(0.25, requestedOpacity))
        : ATTENTION_GLOW_OPACITY,
    },
  };
}

function normalizeRuntimeAttentionGuidance(value, decision) {
  const source = value && typeof value === "object"
    ? value
    : decision?.attentionGuidance && typeof decision.attentionGuidance === "object"
      ? decision.attentionGuidance
      : decision?.option?.attentionGuidance && typeof decision.option.attentionGuidance === "object"
        ? decision.option.attentionGuidance
        : {};
  return {
    schemaVersion: String(source.schemaVersion || "storyvr-attention-guidance/v1"),
    inferenceVersion: String(source.inferenceVersion || "clear-visible-renderables-v1"),
    coordinateSpace: String(source.coordinateSpace || "spatial-scene").trim(),
    inputSignature: String(source.inputSignature || ""),
    readerGuidance: normalizeRuntimeAttentionReaderGuidance(source.readerGuidance),
    resolvedByBeat: normalizeRuntimeAttentionSceneMap(source.resolvedByBeat, "beat"),
    resolvedByVariant: normalizeRuntimeAttentionSceneMap(source.resolvedByVariant, "variant"),
    timeline: Array.isArray(source.timeline) ? source.timeline : [],
  };
}

function normalizeRuntimeSpatialTraversal(value, timeline = []) {
  const source = value && typeof value === "object" ? value : {};
  const timelineStations = Array.isArray(timeline)
    ? timeline.map((entry) => entry?.readerStation).filter(Boolean)
    : [];
  const rawStations = Array.isArray(source.orderedStations) && source.orderedStations.length
    ? source.orderedStations
    : timelineStations;
  const orderedStations = rawStations.map((station, index) => {
    const readerPlacement = station?.readerPosition && typeof station.readerPosition === "object"
      ? station.readerPosition
      : {};
    const readerPosition = Array.isArray(station?.readerPosition)
      ? station.readerPosition
      : readerPlacement.position;
    const rawQuaternion = readerPlacement.quaternion || station?.quaternion;
    return {
      ...station,
      stationId: String(station?.stationId || `station-${index + 1}`),
      order: Number.isFinite(Number(station?.order)) ? Number(station.order) : index,
      beatId: String(station?.beatId || station?.unitId || ""),
      coordinateSpace: String(readerPlacement.coordinateSpace || station?.coordinateSpace || "world"),
      readerPosition: finiteSpatialArray(readerPosition, 3, finiteSpatialArray(station?.position, 3, [0, 0, 0])),
      ...(Array.isArray(rawQuaternion) ? { readerQuaternion: normalizedSpatialQuaternion(rawQuaternion) } : {}),
      anchorAssetId: readerPlacement.anchorAssetId || station?.anchorAssetId || null,
      cueId: readerPlacement.cueId || station?.cueId || null,
      sourceProgress: readerPlacement.sourceProgress ?? station?.sourceProgress ?? null,
    };
  }).filter((station) => station.beatId).sort((left, right) => left.order - right.order);
  const requestedMode = String(source.defaultLocomotionMode || source.locomotionMode || "physical-walking").toLowerCase();
  return {
    schemaVersion: String(source.schemaVersion || "storyvr-spatial-traversal-runtime/v1"),
    requiresLocomotion: Boolean(source.requiresLocomotion && orderedStations.length),
    locomotionMode: requestedMode.includes("virtual") || requestedMode.includes("teleport")
      ? "virtual-teleport"
      : "physical-walking",
    orderedStations,
  };
}

function runtimeProgressionContext(value, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const beatId = String(source.beatId || source.unitId || fallback.beatId || fallback.unitId || "").trim();
  const variantGroupId = String(
    source.variantGroupId || source.groupId || fallback.variantGroupId || fallback.groupId || "",
  ).trim();
  const variantOptionId = String(
    source.variantOptionId || source.optionId || fallback.variantOptionId || fallback.optionId || "",
  ).trim();
  const sceneKey = String(source.sceneKey || fallback.sceneKey || "").trim();
  const cardKind = String(source.cardKind || fallback.cardKind || (variantOptionId ? "variant" : "beat")).trim();
  return {
    ...source,
    ...(beatId ? { beatId } : {}),
    ...(variantGroupId ? { variantGroupId } : {}),
    ...(variantOptionId ? { variantOptionId } : {}),
    ...(sceneKey ? { sceneKey } : {}),
    ...(cardKind ? { cardKind } : {}),
  };
}

function runtimeProgressionContextForRecord(record, direction) {
  const source = record && typeof record === "object" ? record : {};
  const prefix = direction === "to" ? "to" : "from";
  const nested = source[`${prefix}Context`]
    || source[`${prefix}SceneContext`]
    || (source[prefix] && typeof source[prefix] === "object" ? source[prefix] : null);
  return runtimeProgressionContext(nested, {
    beatId: source[`${prefix}BeatId`] || source[`${prefix}UnitId`],
    variantGroupId: source[`${prefix}VariantGroupId`] || (prefix === "from" ? source.variantGroupId : ""),
    variantOptionId: source[`${prefix}VariantOptionId`] || source[`${prefix}OptionId`],
    sceneKey: source[`${prefix}SceneKey`],
    cardKind: source[`${prefix}CardKind`],
  });
}

function normalizeRuntimeProgressionRoute(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fromContext = runtimeProgressionContextForRecord(value, "from");
  const toContext = runtimeProgressionContextForRecord(value, "to");
  const fromBeatId = String(value.fromBeatId || value.fromUnitId || fromContext.beatId || "").trim();
  const toBeatId = String(value.toBeatId || value.toUnitId || toContext.beatId || "").trim();
  if (!fromBeatId || !toBeatId || fromBeatId === toBeatId) return null;
  const hasDeclaredContext = Boolean(
    value.fromContext
    || value.toContext
    || value.fromSceneContext
    || value.toSceneContext
    || value.fromVariantOptionId
    || value.toVariantOptionId,
  );
  const edgeId = String(
    value.edgeId
    || value.routeId
    || value.transitionEdgeId
    || (hasDeclaredContext ? value.boundaryId : "")
    || "",
  ).trim();
  return {
    ...value,
    ...(edgeId ? { edgeId } : {}),
    fromBeatId,
    toBeatId,
    fromContext: runtimeProgressionContext(fromContext, { beatId: fromBeatId }),
    toContext: runtimeProgressionContext(toContext, { beatId: toBeatId }),
  };
}

function runtimeProgressionRouteIsScoped(route) {
  const normalized = normalizeRuntimeProgressionRoute(route);
  return Boolean(normalized && (
    normalized.edgeId
    || normalized.fromContext?.variantOptionId
    || normalized.toContext?.variantOptionId
    || normalized.fromContext?.sceneKey
    || normalized.toContext?.sceneKey
  ));
}

function runtimeProgressionRouteKey(route) {
  const normalized = normalizeRuntimeProgressionRoute(route);
  if (!normalized) return "";
  if (normalized.edgeId) return `edge:${normalized.edgeId}`;
  const contextKey = (context) => [
    context?.beatId,
    context?.variantGroupId,
    context?.variantOptionId,
    context?.sceneKey,
  ].map((part) => String(part || "")).join("|");
  return `${contextKey(normalized.fromContext)}->${contextKey(normalized.toContext)}`;
}

function runtimeProgressionRoutesMatch(left, right) {
  const candidate = normalizeRuntimeProgressionRoute(left);
  const selected = normalizeRuntimeProgressionRoute(right);
  if (!candidate || !selected) return false;
  if (candidate.edgeId && selected.edgeId) return candidate.edgeId === selected.edgeId;
  if (candidate.fromBeatId !== selected.fromBeatId || candidate.toBeatId !== selected.toBeatId) return false;
  if (!runtimeProgressionRouteIsScoped(candidate)) return false;
  for (const direction of ["fromContext", "toContext"]) {
    for (const field of ["variantGroupId", "variantOptionId", "sceneKey"]) {
      const expected = String(candidate[direction]?.[field] || "").trim();
      if (expected && expected !== String(selected[direction]?.[field] || "").trim()) return false;
    }
  }
  return true;
}

function normalizeRuntimeProgressionRoutes(graphEdges = [], interactionRoutes = [], motionTracks = []) {
  const rawRoutes = [
    ...(Array.isArray(graphEdges) ? graphEdges.map((edge) => ({
      ...edge,
      edgeId: edge?.edgeId || edge?.id,
    })) : []),
    ...(Array.isArray(interactionRoutes) ? interactionRoutes : []),
    ...(Array.isArray(motionTracks) ? motionTracks.flatMap((track) => (
      Array.isArray(track?.effective?.transitions) ? track.effective.transitions : []
    )) : []),
  ];
  const routes = new Map();
  for (const rawRoute of rawRoutes) {
    const route = normalizeRuntimeProgressionRoute(rawRoute);
    if (!route || !runtimeProgressionRouteIsScoped(route)) continue;
    const key = runtimeProgressionRouteKey(route);
    const previous = routes.get(key);
    routes.set(key, previous ? {
      ...previous,
      ...route,
      fromContext: { ...previous.fromContext, ...route.fromContext },
      toContext: { ...previous.toContext, ...route.toContext },
    } : route);
  }
  return [...routes.values()];
}

function runtimeInteractionRecordIsRouteAware(record) {
  if (!record || typeof record !== "object") return false;
  return Boolean(
    record.edgeId
    || record.routeId
    || record.transitionEdgeId
    || record.fromContext
    || record.toContext
    || record.fromSceneContext
    || record.toSceneContext
    || record.fromVariantOptionId
    || record.toVariantOptionId,
  );
}

function normalizeRuntimeInteractionControl(interactions, timeline = [], contentUnits = []) {
  const source = interactions && typeof interactions === "object" ? interactions : {};
  const declaredBoundaries = source.interactionControlByBoundary
    ?? source.interactionPolicyByBoundary
    ?? source.interactionAssignments?.boundaries
    ?? [];
  const entries = runtimeInteractionBoundaryEntries(declaredBoundaries);
  const declaredRoutes = runtimeInteractionBoundaryEntries(
    source.interactionControlByRoute
    ?? source.interactionPolicyByRoute
    ?? source.interactionAssignments?.routes
    ?? [],
  );
  const routeEntries = [...declaredRoutes, ...entries.filter(runtimeInteractionRecordIsRouteAware)];
  const legacyEntries = entries.filter((entry) => !runtimeInteractionRecordIsRouteAware(entry));
  const fallbackPolicy = normalizeRuntimeInteractionPolicy(source.interactionPolicy);
  const boundaries = contentUnits.slice(0, -1).map((fromBeat, index) => {
    const toBeat = contentUnits[index + 1];
    const declared = legacyEntries.find((entry) => runtimeInteractionBoundaryMatches(entry, fromBeat, toBeat));
    const unitFallback = runtimeInteractionPolicyForUnit(source.effectiveInteractionPolicyByUnit, toBeat);
    const timelineFallback = runtimeInteractionTimelineEntry(timeline, toBeat, index + 1);
    const effectivePolicy = normalizeRuntimeInteractionPolicy(
      runtimeInteractionPolicyValue(declared, true)
      || runtimeInteractionPolicyValue(unitFallback, true)
      || runtimeInteractionPolicyValue(timelineFallback, true)
      || fallbackPolicy,
    );
    const configuration = normalizeRuntimeInteractionConfiguration(
      declared?.configuration
      || unitFallback?.configuration
      || timelineFallback?.interactionControl?.configuration
      || timelineFallback?.configuration,
      effectivePolicy,
    );
    return {
      ...(declared && typeof declared === "object" ? declared : {}),
      boundaryId: String(declared?.boundaryId || `${fromBeat?.id || index}->${toBeat?.id || index + 1}`),
      fromBeatId: String(declared?.fromBeatId || declared?.fromUnitId || fromBeat?.id || ""),
      toBeatId: String(declared?.toBeatId || declared?.toUnitId || toBeat?.id || ""),
      inferredPolicy: normalizeRuntimeInteractionPolicy(
        runtimeInteractionPolicyValue(declared, false) || effectivePolicy,
      ),
      effectivePolicy,
      overridden: Boolean(declared?.overridden || declared?.override || declared?.source === "author"),
      reason: String(declared?.reason || ""),
      evidence: declared?.evidence ?? null,
      locomotionMode: normalizeRuntimeLocomotionMode(
        declared?.locomotionMode
        || unitFallback?.locomotionMode
        || timelineFallback?.locomotionMode
        || source.locomotionMode,
      ),
      ...(configuration ? { configuration } : {}),
    };
  });
  const routesByKey = new Map();
  for (const rawRoute of routeEntries) {
    const route = normalizeRuntimeProgressionRoute(rawRoute);
    if (!route || !runtimeProgressionRouteIsScoped(route)) continue;
    const fromBeat = contentUnits.find((beat) => runtimeBeatIdentityValues(beat).includes(route.fromBeatId));
    const toBeat = contentUnits.find((beat) => runtimeBeatIdentityValues(beat).includes(route.toBeatId));
    const legacy = fromBeat && toBeat
      ? legacyEntries.find((entry) => runtimeInteractionBoundaryMatches(entry, fromBeat, toBeat))
      : null;
    const effectivePolicy = normalizeRuntimeInteractionPolicy(
      runtimeInteractionPolicyValue(rawRoute, true)
      || runtimeInteractionPolicyValue(legacy, true)
      || fallbackPolicy,
    );
    const configuration = normalizeRuntimeInteractionConfiguration(
      rawRoute.configuration || legacy?.configuration,
      effectivePolicy,
    );
    const normalized = {
      ...rawRoute,
      ...route,
      boundaryId: String(rawRoute.boundaryId || route.edgeId || `${route.fromBeatId}->${route.toBeatId}`),
      inferredPolicy: normalizeRuntimeInteractionPolicy(
        runtimeInteractionPolicyValue(rawRoute, false) || effectivePolicy,
      ),
      effectivePolicy,
      overridden: Boolean(rawRoute.overridden || rawRoute.override || rawRoute.source === "author"),
      reason: String(rawRoute.reason || ""),
      evidence: rawRoute.evidence ?? null,
      locomotionMode: normalizeRuntimeLocomotionMode(
        rawRoute.locomotionMode || legacy?.locomotionMode || source.locomotionMode,
      ),
      ...(configuration ? { configuration } : {}),
    };
    routesByKey.set(runtimeProgressionRouteKey(normalized), normalized);
  }
  return {
    schemaVersion: String(source.interactionControlSchemaVersion || "storyvr-interaction-control-runtime/v1"),
    fallbackPolicy,
    boundaries,
    routes: [...routesByKey.values()],
  };
}

function runtimeInteractionBoundaryEntries(value) {
  if (Array.isArray(value)) return value.map((entry) => runtimeInteractionBoundaryEntry(entry));
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.boundaries)) return value.boundaries.map((entry) => runtimeInteractionBoundaryEntry(entry));
  if (Array.isArray(value.routes)) return value.routes.map((entry) => runtimeInteractionBoundaryEntry(entry));
  if (Array.isArray(value.assignments)) return value.assignments.map((entry) => runtimeInteractionBoundaryEntry(entry));
  return Object.entries(value)
    .filter(([key]) => !["schemaVersion", "sourceSignature"].includes(key))
    .map(([key, entry]) => runtimeInteractionBoundaryEntry(entry, key));
}

function runtimeInteractionBoundaryEntry(value, mapKey = "") {
  const entry = value && typeof value === "object" ? { ...value } : { effectivePolicy: value };
  if (!mapKey) return entry;
  if (entry.fromBeatId || entry.toBeatId || entry.fromUnitId || entry.toUnitId) {
    return { ...entry, boundaryId: entry.boundaryId || mapKey };
  }
  const match = String(mapKey).match(/^(.*?)\s*(?:->|=>|::)\s*(.*?)$/);
  if (!match) return { ...entry, boundaryId: entry.boundaryId || mapKey };
  return {
    ...entry,
    boundaryId: entry.boundaryId || mapKey,
    fromBeatId: match[1].trim(),
    toBeatId: match[2].trim(),
  };
}

function runtimeInteractionBoundaryMatches(entry, fromBeat, toBeat) {
  if (!entry || typeof entry !== "object") return false;
  const fromId = String(entry.fromBeatId || entry.fromUnitId || "").trim();
  const toId = String(entry.toBeatId || entry.toUnitId || "").trim();
  const fromIds = runtimeBeatIdentityValues(fromBeat);
  const toIds = runtimeBeatIdentityValues(toBeat);
  if (fromId && toId) return fromIds.includes(fromId) && toIds.includes(toId);
  const boundaryId = String(entry.boundaryId || "");
  return fromIds.some((candidateFrom) => toIds.some((candidateTo) => (
    boundaryId === `${candidateFrom}->${candidateTo}`
    || boundaryId === `${candidateFrom}=>${candidateTo}`
    || boundaryId === `${candidateFrom}::${candidateTo}`
  )));
}

function runtimeBeatIdentityValues(beat) {
  if (!beat || typeof beat !== "object") return [];
  return [...new Set([
    beat.id,
    beat.beatId,
    beat.unitId,
    beat.sourceBeatId,
    ...(Array.isArray(beat.beatIds) ? beat.beatIds : []),
    ...(Array.isArray(beat.sourceBeatIds) ? beat.sourceBeatIds : []),
    ...(Array.isArray(beat.atomicBeatIds) ? beat.atomicBeatIds : []),
  ].map((value) => String(value || "").trim()).filter(Boolean))];
}

function runtimeInteractionPolicyForUnit(value, beat) {
  if (!value || typeof value !== "object") return null;
  for (const id of runtimeBeatIdentityValues(beat)) {
    if (Object.prototype.hasOwnProperty.call(value, id)) return value[id];
  }
  return null;
}

function runtimeInteractionTimelineEntry(timeline, beat, expectedIndex) {
  if (!Array.isArray(timeline)) return null;
  const ids = runtimeBeatIdentityValues(beat);
  return timeline.find((entry) => ids.some((id) => [entry?.unitId, entry?.beatId, entry?.id].includes(id)))
    || timeline[expectedIndex]
    || null;
}

function runtimeInteractionPolicyValue(entry, effective = true) {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return "";
  if (effective) {
    return entry.effectivePolicy
      || entry.selectedPolicy
      || entry.authoredPolicy
      || entry.policy
      || entry.interactionPolicy
      || entry.option?.label
      || entry.label
      || entry.inferredPolicy
      || "";
  }
  return entry.inferredPolicy || entry.policy || entry.interactionPolicy || entry.option?.label || entry.label || "";
}

function normalizeRuntimeInteractionPolicy(value) {
  const raw = typeof value === "string" ? value.trim() : runtimeInteractionPolicyValue(value, true).trim();
  const label = raw.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!label) return "Controller button press";
  if (label.includes("direct manipulation")) return "Direct manipulation";
  if (label.includes("branch")) return "Branching selection";
  if (label.includes("reader locomotion") || label.includes("embodied progression")) return "Reader locomotion";
  if (label.includes("button stepping") || (label.includes("controller") && /button|press|advance|step/.test(label))) {
    return "Controller button press";
  }
  return raw;
}

function normalizeRuntimeLocomotionMode(value) {
  const mode = String(value || "").toLowerCase();
  return mode.includes("virtual") || mode.includes("teleport") ? "virtual-teleport" : "physical-walking";
}

function finiteInteractionArray(value, length, fallback) {
  if (!Array.isArray(value) || value.length < length) return [...fallback];
  const normalized = value.slice(0, length).map(Number);
  return normalized.every(Number.isFinite) ? normalized : [...fallback];
}

function finiteInteractionNumber(value, fallback, minimum = -Infinity, maximum = Infinity) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
}

function normalizeRuntimeControllerControl(value) {
  const control = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  const aliases = {
    squeeze: "grip",
    "primary-trigger": "trigger",
    "thumbstick-click": "thumbstick-press",
    thumbstick: "thumbstick-press",
    "joystick-click": "thumbstick-press",
    "joystick-up": "thumbstick-up",
    "joystick-down": "thumbstick-down",
    "joystick-left": "thumbstick-left",
    "joystick-right": "thumbstick-right",
  };
  return aliases[control] || control;
}

function normalizeRuntimeControllerAction(value) {
  const action = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (["next", "advance", "advance-beat", "go-to-next-beat"].includes(action)) return "next-beat";
  if (["previous", "back", "previous-beat", "go-to-previous-beat"].includes(action)) return "previous-beat";
  if (["next-option", "next-variant"].includes(action)) return "next-option";
  if (["previous-option", "previous-variant"].includes(action)) return "previous-option";
  if (["", "none", "unmapped", "disabled", "no-op"].includes(action)) return "unmapped";
  return action;
}

function normalizeRuntimeTransform(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const quaternion = finiteInteractionArray(source.quaternion, 4, [0, 0, 0, 1]);
  const quaternionLength = Math.hypot(...quaternion);
  return {
    position: finiteInteractionArray(source.position, 3, [0, 0, 0]),
    quaternion: quaternionLength > 0
      ? quaternion.map((component) => component / quaternionLength)
      : [0, 0, 0, 1],
    scale: finiteInteractionArray(source.scale, 3, [1, 1, 1]),
  };
}

function runtimeInBeatSceneKey(beatId, variantGroupId = "", variantOptionId = "") {
  const normalizedBeatId = String(beatId || "").trim();
  const normalizedGroupId = String(variantGroupId || "").trim();
  const normalizedOptionId = String(variantOptionId || "").trim();
  if (!normalizedBeatId) return "";
  if (normalizedGroupId && normalizedOptionId) {
    return `beat:${normalizedBeatId}:group:${normalizedGroupId}:variant:${normalizedOptionId}`;
  }
  return `beat:${normalizedBeatId}`;
}

function runtimeInteractionRangeArray(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) {
    const normalized = value.slice(0, 3).map(Number);
    if (normalized.every(Number.isFinite)) return normalized;
  }
  const scalar = Number(value);
  return Number.isFinite(scalar) ? [scalar, scalar, scalar] : [...fallback];
}

function normalizeRuntimeInteractionRange(value, channel) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value;
  const rotation = channel === "rotation";
  const minimumValue = rotation
    ? source.minDegrees ?? source.minimumDegrees ?? source.min
    : source.min ?? source.minimum;
  const maximumValue = rotation
    ? source.maxDegrees ?? source.maximumDegrees ?? source.max
    : source.max ?? source.maximum;
  const hasRange = minimumValue !== undefined || maximumValue !== undefined;
  if (source.enabled === false || (!hasRange && source.enabled !== true)) return null;
  const fallbackMinimum = channel === "scale" ? [0.0001, 0.0001, 0.0001]
    : rotation ? [-180, -180, -180] : [-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE];
  const fallbackMaximum = rotation ? [180, 180, 180]
    : [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE];
  const requestedMinimum = runtimeInteractionRangeArray(minimumValue, fallbackMinimum);
  const requestedMaximum = runtimeInteractionRangeArray(maximumValue, fallbackMaximum);
  const min = [];
  const max = [];
  for (let index = 0; index < 3; index += 1) {
    const first = channel === "scale" ? Math.max(0.0001, requestedMinimum[index]) : requestedMinimum[index];
    const second = channel === "scale" ? Math.max(0.0001, requestedMaximum[index]) : requestedMaximum[index];
    min.push(Math.min(first, second));
    max.push(Math.max(first, second));
  }
  return { enabled: true, min, max };
}

function normalizeRuntimeInteractionConstraints(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value;
  const position = normalizeRuntimeInteractionRange(
    source.position || source.translation || (source.positionMin || source.positionMax ? {
      min: source.positionMin,
      max: source.positionMax,
      enabled: source.positionEnabled,
    } : null),
    "position",
  );
  const rotation = normalizeRuntimeInteractionRange(
    source.rotation || (source.rotationMinDegrees || source.rotationMaxDegrees ? {
      minDegrees: source.rotationMinDegrees,
      maxDegrees: source.rotationMaxDegrees,
      enabled: source.rotationEnabled,
    } : null),
    "rotation",
  );
  const scale = normalizeRuntimeInteractionRange(
    source.scale || (source.scaleMin || source.scaleMax ? {
      min: source.scaleMin,
      max: source.scaleMax,
      enabled: source.scaleEnabled,
    } : null),
    "scale",
  );
  return {
    ...(position ? { position } : {}),
    ...(rotation ? { rotation } : {}),
    ...(scale ? { scale } : {}),
  };
}

function normalizeRuntimeInBeatInteractionTarget(value, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entityId = value.entityId ? String(value.entityId).trim() : "";
  const assetId = value.assetId ? String(value.assetId).trim() : "";
  if (!entityId && !assetId) return null;
  const nodePath = value.nodePath ? String(value.nodePath).trim().replace(/^\/+|\/+$/g, "") : "";
  const requestedNodeIndex = Number(value.nodeIndex);
  const nodeIndex = Number.isInteger(requestedNodeIndex) && requestedNodeIndex >= 0 ? requestedNodeIndex : null;
  const oneHandGrabbable = value.oneHandGrabbable === true || value.grabbable === true;
  const twoHandScalable = value.twoHandScalable === true || value.scalable === true;
  if (!oneHandGrabbable && !twoHandScalable) return null;
  const elasticDragging = oneHandGrabbable && value.elasticDragging === true;
  const initialTransform = normalizeRuntimeTransform(value.initialTransform);
  initialTransform.scale = initialTransform.scale.map((component) => (
    Number.isFinite(component) && component > 0 ? component : 1
  ));
  const normalizedConstraints = normalizeRuntimeInteractionConstraints(value.constraints);
  const constraints = {
    ...(oneHandGrabbable && normalizedConstraints.position ? { position: normalizedConstraints.position } : {}),
    ...(oneHandGrabbable && normalizedConstraints.rotation ? { rotation: normalizedConstraints.rotation } : {}),
    ...(twoHandScalable && normalizedConstraints.scale ? { scale: normalizedConstraints.scale } : {}),
  };
  return {
    ...value,
    targetId: String(value.targetId || entityId || assetId || `in-beat-target-${index + 1}`).trim(),
    entityId: entityId || null,
    assetId: assetId || null,
    ...(nodePath ? { nodePath } : {}),
    ...(nodeIndex !== null ? { nodeIndex } : {}),
    targetKind: nodePath || nodeIndex !== null ? "node" : "entity",
    coordinateSpace: "local",
    oneHandGrabbable,
    twoHandScalable,
    elasticDragging,
    initialTransform,
    constraints,
  };
}

function normalizeRuntimeInBeatInteractions(value) {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([sceneKey, record]) => ({ ...record, sceneKey: record?.sceneKey || sceneKey }))
      : [];
  return entries.flatMap((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return [];
    const beatId = String(record.beatId || record.unitId || "").trim();
    const variantGroupId = String(record.variantGroupId || record.groupId || "").trim();
    const variantOptionId = String(record.variantOptionId || record.optionId || "").trim();
    const sceneKey = String(record.sceneKey || runtimeInBeatSceneKey(beatId, variantGroupId, variantOptionId)).trim();
    if (!beatId || !sceneKey || Boolean(variantGroupId) !== Boolean(variantOptionId)) return [];
    const targetsByKey = new Map();
    for (const [targetIndex, rawTarget] of (Array.isArray(record.targets) ? record.targets : []).entries()) {
      const target = normalizeRuntimeInBeatInteractionTarget(rawTarget, targetIndex);
      if (!target) continue;
      const partKey = target.nodeIndex !== undefined ? `index:${target.nodeIndex}` : `path:${target.nodePath || ""}`;
      const key = `${target.entityId || ""}|${target.assetId || ""}|${partKey}`;
      targetsByKey.set(key, target);
    }
    const targets = [...targetsByKey.values()];
    if (!targets.length) return [];
    const entitiesWithParts = new Set(targets.filter((target) => target.targetKind === "node").map((target) => (
      `${target.entityId || ""}|${target.assetId || ""}`
    )));
    const withoutWholeObjectOverlaps = targets.filter((target) => (
      target.targetKind === "node"
      || !entitiesWithParts.has(`${target.entityId || ""}|${target.assetId || ""}`)
    ));
    const withoutAncestorPartOverlaps = withoutWholeObjectOverlaps.filter((target, index, allTargets) => {
      const targetPath = String(target.nodePath || "").replace(/^\/+|\/+$/g, "").toLowerCase();
      if (!targetPath) return true;
      const targetScope = `${target.entityId || ""}|${target.assetId || ""}`;
      return !allTargets.some((candidate, candidateIndex) => {
        if (candidateIndex === index) return false;
        const candidateScope = `${candidate.entityId || ""}|${candidate.assetId || ""}`;
        const candidatePath = String(candidate.nodePath || "").replace(/^\/+|\/+$/g, "").toLowerCase();
        return candidateScope === targetScope && candidatePath.startsWith(`${targetPath}/`);
      });
    });
    return [{
      ...record,
      sceneKey,
      beatId,
      ...(variantGroupId ? { variantGroupId } : {}),
      ...(variantOptionId ? { variantOptionId } : {}),
      targets: withoutAncestorPartOverlaps,
    }];
  });
}

function runtimeInBeatInteractionForScene(records, spatialScene, beat, variantGroup = null, variantOption = null) {
  const beatId = String(beat?.id || beat?.beatId || spatialScene?.beatId || spatialScene?.unitId || "").trim();
  const variantGroupId = String(variantGroup?.id || variantGroup?.groupId || spatialScene?.variantGroupId || "").trim();
  const variantOptionId = String(variantOption?.id || variantOption?.optionId || spatialScene?.variantOptionId || "").trim();
  const canonicalKey = runtimeInBeatSceneKey(beatId, variantGroupId, variantOptionId);
  const spatialSceneKey = String(spatialScene?.sceneKey || "").trim();
  return (Array.isArray(records) ? records : []).find((record) => {
    if (String(record?.beatId || "") !== beatId) return false;
    const recordGroupId = String(record?.variantGroupId || "");
    const recordOptionId = String(record?.variantOptionId || "");
    if (recordGroupId !== variantGroupId || recordOptionId !== variantOptionId) return false;
    const recordSceneKey = String(record?.sceneKey || "");
    return recordSceneKey === canonicalKey || Boolean(spatialSceneKey && recordSceneKey === spatialSceneKey);
  }) || null;
}

function normalizeRuntimeInteractionConfiguration(value, policy) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value;
  const normalizedPolicy = normalizeRuntimeInteractionPolicy(policy || source.type);
  const schemaVersion = String(source.schemaVersion || "storyvr-interaction-configuration/v1");
  if (normalizedPolicy === "Controller button press") {
    const bindings = (Array.isArray(source.bindings) ? source.bindings : []).flatMap((binding) => {
      const hand = String(binding?.hand || binding?.handedness || "any").trim().toLowerCase();
      const input = normalizeRuntimeControllerControl(binding?.input || binding?.control);
      const action = normalizeRuntimeControllerAction(binding?.action);
      if (!["left", "right", "any"].includes(hand) || !input) return [];
      return [{ ...binding, hand, input, action }];
    });
    return {
      ...source,
      schemaVersion,
      type: "controller-button-press",
      profile: String(source.profile || "meta-quest-touch-plus"),
      bindings,
    };
  }
  if (normalizedPolicy === "UI button press") {
    const rawButtons = Array.isArray(source.buttons)
      ? source.buttons
      : source.button && typeof source.button === "object" ? [source.button] : [];
    const buttons = rawButtons.flatMap((button, index) => {
      if (!button || typeof button !== "object") return [];
      const position = finiteInteractionArray(button.position, 2, [0.5, 0.86])
        .map((component) => THREE.MathUtils.clamp(component, 0, 1));
      const size = finiteInteractionArray(button.size, 2, [0.32, 0.12])
        .map((component) => THREE.MathUtils.clamp(component, 0.04, 1));
      return [{
        ...button,
        id: String(button.id || `button-${index + 1}`),
        label: String(button.label || "").trim(),
        action: normalizeRuntimeControllerAction(button.action || "next-option"),
        position,
        size,
      }];
    });
    return {
      ...source,
      schemaVersion,
      type: "ui-button-press",
      buttons,
    };
  }
  if (normalizedPolicy === "Reader locomotion") {
    const destination = source.destination && typeof source.destination === "object" ? source.destination : {};
    const tolerance = source.tolerance && typeof source.tolerance === "object" ? source.tolerance : {};
    return {
      ...source,
      schemaVersion,
      type: "reader-locomotion",
      destination: {
        ...destination,
        coordinateSpace: String(destination.coordinateSpace || "world").trim().toLowerCase(),
        transform: normalizeRuntimeTransform(destination.transform),
      },
      tolerance: {
        ...tolerance,
        distanceMeters: finiteInteractionNumber(
          tolerance.distanceMeters,
          DEFAULT_LOCOMOTION_DISTANCE_METERS,
          0.05,
        ),
        dwellSeconds: finiteInteractionNumber(
          tolerance.dwellSeconds,
          DEFAULT_LOCOMOTION_DWELL_SECONDS,
          0,
        ),
      },
    };
  }
  if (normalizedPolicy === "Direct manipulation") {
    const tolerance = source.tolerance && typeof source.tolerance === "object" ? source.tolerance : {};
    const normalizedTolerance = {
      positionMeters: finiteInteractionNumber(tolerance.positionMeters, DEFAULT_DIRECT_POSITION_TOLERANCE_METERS, 0.001),
      rotationDegrees: finiteInteractionNumber(tolerance.rotationDegrees, DEFAULT_DIRECT_ROTATION_TOLERANCE_DEGREES, 0.1),
      scaleRatio: finiteInteractionNumber(tolerance.scaleRatio, DEFAULT_DIRECT_SCALE_TOLERANCE_RATIO, 0.001),
    };
    const targets = (Array.isArray(source.targets) ? source.targets : []).flatMap((target, index) => {
      if (!target || typeof target !== "object" || !target.destinationTransform) return [];
      const requestedNodeIndex = Number(target.nodeIndex);
      const nodeIndex = Number.isInteger(requestedNodeIndex) && requestedNodeIndex >= 0 ? requestedNodeIndex : null;
      const targetKind = String(target.targetKind || (target.nodePath || nodeIndex !== null ? "node" : "entity")).trim().toLowerCase();
      const targetId = String(target.targetId || target.entityId || target.assetId || target.nodePath || `target-${index + 1}`).trim();
      const entityId = target.entityId ? String(target.entityId) : null;
      const assetId = target.assetId ? String(target.assetId) : null;
      if (!targetId || (!entityId && !assetId)) return [];
      const targetTolerance = target.tolerance && typeof target.tolerance === "object" ? target.tolerance : {};
      return [{
        ...target,
        targetId,
        entityId,
        assetId,
        nodePath: target.nodePath ? String(target.nodePath) : null,
        ...(nodeIndex !== null ? { nodeIndex } : {}),
        targetKind,
        coordinateSpace: String(target.coordinateSpace || "scene").trim().toLowerCase(),
        destinationTransform: normalizeRuntimeTransform(target.destinationTransform),
        tolerance: {
          positionMeters: finiteInteractionNumber(targetTolerance.positionMeters, normalizedTolerance.positionMeters, 0.001),
          rotationDegrees: finiteInteractionNumber(targetTolerance.rotationDegrees, normalizedTolerance.rotationDegrees, 0.1),
          scaleRatio: finiteInteractionNumber(targetTolerance.scaleRatio, normalizedTolerance.scaleRatio, 0.001),
        },
      }];
    });
    const partTargets = targets.filter((target) => target.nodePath || target.nodeIndex !== undefined);
    const entityIdsWithPartTargets = new Set(partTargets.flatMap((target) => target.entityId ? [target.entityId] : []));
    const assetIdsWithPartTargets = new Set(partTargets.flatMap((target) => target.assetId ? [target.assetId] : []));
    const assetIdsWithUnqualifiedPartTargets = new Set(partTargets.flatMap((target) => !target.entityId && target.assetId ? [target.assetId] : []));
    const nonOverlappingTargets = targets.filter((target) => {
      if (target.nodePath || target.nodeIndex !== undefined) return true;
      if (target.entityId && entityIdsWithPartTargets.has(target.entityId)) return false;
      if (!target.entityId && target.assetId && assetIdsWithPartTargets.has(target.assetId)) return false;
      if (target.entityId && target.assetId && assetIdsWithUnqualifiedPartTargets.has(target.assetId)) return false;
      return true;
    });
    return {
      ...source,
      schemaVersion,
      type: "direct-manipulation",
      targets: nonOverlappingTargets,
      tolerance: normalizedTolerance,
      completion: source.completion === "any" ? "any" : "all",
    };
  }
  return { ...source, schemaVersion };
}

function spatialEntityIndex(value) {
  if (Array.isArray(value)) {
    return Object.fromEntries(value
      .filter((entity) => entity && typeof entity === "object" && (entity.id || entity.entityId))
      .map((entity) => [String(entity.id || entity.entityId), entity]));
  }
  return value && typeof value === "object" ? value : {};
}

function spatialSceneRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value.scene && typeof value.scene === "object" && !Array.isArray(value.scene)
    ? value.scene
    : value;
}

function spatialSceneMatches(scene, beatId, variantOptionId = "") {
  if (!scene || typeof scene !== "object") return false;
  const declaredBeatId = String(scene.beatId || scene.unitId || "").trim();
  const declaredOptionId = String(scene.variantOptionId || scene.optionId || "").trim();
  if (declaredBeatId && beatId && declaredBeatId !== beatId) return false;
  if (declaredOptionId && variantOptionId && declaredOptionId !== variantOptionId) return false;
  return true;
}

function spatialVariantSceneFromMap(value, beatId, variantOptionId, sceneKey = "") {
  if (!value || typeof value !== "object" || !variantOptionId) return null;
  const directKeys = uniqueStrings([
    sceneKey,
    variantOptionId,
    beatId && `${beatId}:${variantOptionId}`,
    beatId && `${beatId}:variant:${variantOptionId}`,
  ]);
  for (const key of directKeys) {
    const direct = spatialSceneRecord(value[key]);
    if (direct && spatialSceneMatches(direct, beatId, variantOptionId)) return direct;
  }
  const beatContainer = beatId && value[beatId] && typeof value[beatId] === "object" ? value[beatId] : null;
  if (beatContainer) {
    for (const key of directKeys) {
      const nested = spatialSceneRecord(beatContainer[key]);
      if (nested && spatialSceneMatches(nested, beatId, variantOptionId)) return nested;
    }
  }
  const candidates = [
    ...Object.values(value),
    ...(beatContainer ? Object.values(beatContainer) : []),
  ];
  for (const candidate of candidates) {
    const scene = spatialSceneRecord(candidate);
    if (!scene || !spatialSceneMatches(scene, beatId, variantOptionId)) continue;
    if (String(scene.variantOptionId || scene.optionId || "").trim() === variantOptionId) return scene;
  }
  return null;
}

function spatialVariantSceneFromRecord(record, beatId, variantOptionId) {
  if (!record || typeof record !== "object" || !variantOptionId) return null;
  for (const container of [
    record.variantsByOptionId,
    record.resolvedByVariant,
    record.variants,
    record.variantScenes,
    record.byVariant,
    record.options,
  ]) {
    const scene = spatialVariantSceneFromMap(container, beatId, variantOptionId);
    if (scene) return scene;
  }
  return null;
}

function spatialSceneForRuntime(spatialRelations, timeline, beat, index, variantOption = null) {
  if (!beat?.id) return null;
  const variantOptionId = String(variantOption?.id || variantOption?.optionId || variantOption || "").trim();
  const timelineEntry = timeline?.[index];
  const timelineRelations = timelineEntry?.spatialRelations
    || (timelineEntry?.spatialEntities ? { entities: timelineEntry.spatialEntities } : null);
  const timelineScene = spatialSceneRecord(timelineRelations);
  const timelineVariant = spatialVariantSceneFromRecord(timelineRelations, beat.id, variantOptionId);
  if (timelineVariant) return timelineVariant;

  const variantMetadata = (spatialRelations?.timeline || []).find((entry) => (
    String(entry?.beatId || entry?.unitId || "") === beat.id
    && String(entry?.variantOptionId || entry?.optionId || "") === variantOptionId
  ));
  const resolvedVariant = spatialVariantSceneFromMap(
    spatialRelations?.resolvedByVariant,
    beat.id,
    variantOptionId,
    String(variantMetadata?.sceneKey || ""),
  );
  if (resolvedVariant) return resolvedVariant;
  if (timelineScene && spatialSceneMatches(timelineScene, beat.id)) return timelineScene;
  return spatialSceneRecord(spatialRelations?.resolvedByBeat?.[beat.id]);
}

function attentionSceneMatches(scene, beatId, variantOptionId = "") {
  if (!scene || typeof scene !== "object") return false;
  const declaredBeatId = String(scene.beatId || scene.unitId || "").trim();
  const declaredOptionId = String(scene.variantOptionId || scene.optionId || "").trim();
  if (declaredBeatId && beatId && declaredBeatId !== beatId) return false;
  if (variantOptionId && declaredOptionId !== variantOptionId) return false;
  return true;
}

function attentionVariantSceneFromMap(value, beatId, variantOptionId, sceneKey = "") {
  if (!value || typeof value !== "object" || !variantOptionId) return null;
  const directKeys = uniqueStrings([
    sceneKey,
    `${beatId}:${variantOptionId}`,
    `${beatId}:variant:${variantOptionId}`,
    `beat:${beatId}:variant:${variantOptionId}`,
    variantOptionId,
  ]);
  for (const key of directKeys) {
    const direct = normalizeRuntimeAttentionScene(value[key], beatId, variantOptionId);
    if (attentionSceneMatches(direct, beatId, variantOptionId)) return direct;
  }
  for (const candidate of Object.values(value)) {
    const scene = normalizeRuntimeAttentionScene(candidate);
    if (attentionSceneMatches(scene, beatId, variantOptionId)) return scene;
  }
  return null;
}

function attentionVariantSceneFromRecord(value, beatId, variantOptionId) {
  if (!value || typeof value !== "object" || !variantOptionId) return null;
  for (const container of [
    value.variantsByOptionId,
    value.resolvedByVariant,
    value.variants,
    value.variantScenes,
    value.byVariant,
    value.options,
  ]) {
    const scene = attentionVariantSceneFromMap(container, beatId, variantOptionId);
    if (scene) return scene;
  }
  const direct = normalizeRuntimeAttentionScene(value);
  return attentionSceneMatches(direct, beatId, variantOptionId) ? direct : null;
}

function attentionSceneForRuntime(attentionGuidance, timeline, beat, index, variantOption = null) {
  if (!beat?.id) return null;
  const beatId = String(beat.id);
  const variantOptionId = String(variantOption?.id || variantOption?.optionId || variantOption || "").trim();
  const timelineRecord = timeline?.[index]?.attentionGuidance;
  const unitRecord = beat.attentionGuidance;
  const timelineVariant = attentionVariantSceneFromRecord(timelineRecord, beatId, variantOptionId);
  if (timelineVariant) return timelineVariant;
  const unitVariant = attentionVariantSceneFromRecord(unitRecord, beatId, variantOptionId);
  if (unitVariant) return unitVariant;

  const variantMetadata = (attentionGuidance?.timeline || []).find((entry) => (
    String(entry?.beatId || entry?.unitId || "") === beatId
    && String(entry?.variantOptionId || entry?.optionId || "") === variantOptionId
  ));
  const resolvedVariant = attentionVariantSceneFromMap(
    attentionGuidance?.resolvedByVariant,
    beatId,
    variantOptionId,
    String(variantMetadata?.sceneKey || ""),
  );
  if (resolvedVariant) return resolvedVariant;

  const timelineScene = normalizeRuntimeAttentionScene(timelineRecord, beatId);
  if (attentionSceneMatches(timelineScene, beatId)) return timelineScene;
  const unitScene = normalizeRuntimeAttentionScene(unitRecord, beatId);
  if (attentionSceneMatches(unitScene, beatId)) return unitScene;
  return normalizeRuntimeAttentionScene(attentionGuidance?.resolvedByBeat?.[beatId], beatId);
}

function exposeRuntimeAttentionGuidance(targetScene, attentionScene) {
  const metadata = attentionScene && typeof attentionScene === "object" ? attentionScene : null;
  targetScene.userData = targetScene.userData || {};
  targetScene.userData.storyvrAttentionGuidance = metadata;
  return metadata;
}

function runtimeSpatialSceneForBeat(
  beat = beats[activeIndex],
  index = activeIndex,
  variantOption = runtimeVariantOptionForGroup(runtimeVariantGroupForBeat(beat)),
) {
  return spatialSceneForRuntime(runtimeSpatialRelations, runtime.timeline, beat, index, variantOption);
}

function runtimeAttentionGuidanceForBeat(
  beat = beats[activeIndex],
  index = activeIndex,
  variantOption = runtimeVariantOptionForGroup(runtimeVariantGroupForBeat(beat)),
) {
  return attentionSceneForRuntime(runtimeAttentionGuidance, runtime.timeline, beat, index, variantOption);
}

function attentionCompletionKey(attentionScene, marker) {
  const beatId = String(attentionScene?.beatId || attentionScene?.unitId || "unknown-beat").trim();
  const variantOptionId = String(attentionScene?.variantOptionId || attentionScene?.optionId || "").trim();
  const sceneKey = String(
    attentionScene?.sceneKey
      || (variantOptionId ? `beat:${beatId}:variant:${variantOptionId}` : `beat:${beatId}`),
  ).trim();
  const markerId = String(marker?.id || `${marker?.assetId || "unknown-asset"}:${marker?.partSelector || "whole"}`).trim();
  return `${sceneKey}::${markerId}`;
}

function attentionCueFrameDecision({
  completed = false,
  targetVisible = false,
  distanceToBounds = Infinity,
  completionDistanceMeters = ATTENTION_COMPLETION_DISTANCE_METERS,
  inFieldOfView = false,
} = {}) {
  const distance = Number(distanceToBounds);
  const threshold = Math.max(0, Number(completionDistanceMeters) || ATTENTION_COMPLETION_DISTANCE_METERS);
  const shouldComplete = !completed && targetVisible && Number.isFinite(distance) && distance <= threshold;
  const active = !completed && !shouldComplete && targetVisible;
  return {
    shouldComplete,
    showArrow: active && !inFieldOfView,
    showGlow: active,
  };
}

function runtimeAttentionSelectorIsExact(value) {
  const selector = String(value || "").trim();
  return Boolean(selector) && !/[\*{}]|\.\.|\s+plus\s+/i.test(selector);
}

function runtimeAttentionMeshHasVisibleMaterial(mesh) {
  const materials = Array.isArray(mesh?.material) ? mesh.material : [mesh?.material].filter(Boolean);
  if (!materials.length) return true;
  return materials.some((material) => (
    material?.visible !== false
    && material?.colorWrite !== false
    && (!Number.isFinite(Number(material?.opacity)) || Number(material.opacity) > 0.02)
  ));
}

function runtimeAttentionMeshIsVisible(mesh, root) {
  if (
    !mesh?.isMesh
    || !mesh.geometry
    || !runtimeAttentionMeshHasVisibleMaterial(mesh)
  ) return false;
  const positionCount = Number(mesh.geometry.attributes?.position?.count) || 0;
  const drawCount = Number(mesh.geometry.drawRange?.count);
  if (positionCount <= 0 || (Number.isFinite(drawCount) && drawCount <= 0)) return false;
  let reachedRoot = false;
  let current = mesh;
  while (current) {
    if (current.visible === false) return false;
    if (current === root) reachedRoot = true;
    current = current.parent;
  }
  return reachedRoot;
}

function resolveRuntimeAttentionTarget(attentionScene, marker) {
  if (!marker?.assetId || marker.coordinateSpace !== "spatial-scene") return null;
  const matchingEntries = [
    ...(activeModel && activeModelAsset?.id === marker.assetId ? [{
      asset: activeModelAsset,
      model: activeModel,
      playback: activeSourceAnimation,
      authorTransformRoot: modelAuthorTransformRoot,
    }] : []),
    ...activeSupplementalModelEntries.filter((entry) => entry.asset?.id === marker.assetId),
  ];
  const entityId = String(marker.entityId || "").trim();
  const modelEntries = entityId
    ? matchingEntries.filter((entry) => (
      String(entry.authorTransformRoot?.userData?.spatialEntityId || "") === entityId
    ))
    : matchingEntries;
  const selector = String(marker.partSelector || "").trim();
  const targetKind = String(marker.targetKind || "").trim();
  if (selector && targetKind !== "named-renderable-part") return null;
  if (!selector && targetKind !== "standalone-glb") return null;
  if (selector && !runtimeAttentionSelectorIsExact(selector)) return null;
  const groups = modelEntries.flatMap((modelEntry) => {
    const root = modelEntry?.model || null;
    if (!root?.traverse) return [];
    const meshes = [];
    root.traverse((object) => {
      if (!object?.isMesh || !object.geometry) return;
      if (!selector || sourcePartSelectorMatchesNode(selector, object, root)) meshes.push(object);
    });
    return meshes.length ? [{ modelEntry, root, meshes, bounds: new THREE.Box3() }] : [];
  });
  const meshes = groups.flatMap((group) => group.meshes);
  if (!meshes.length) return null;
  return {
    key: attentionCompletionKey(attentionScene, marker),
    scene: attentionScene,
    marker,
    modelEntry: groups[0].modelEntry,
    modelEntries: groups.map((group) => group.modelEntry),
    root: groups[0].root,
    groups,
    rootsByMesh: new Map(groups.flatMap((group) => group.meshes.map((mesh) => [mesh, group.root]))),
    meshes,
    bounds: new THREE.Box3(),
    meshBounds: new THREE.Box3(),
    arrow: null,
    completed: false,
  };
}

function runtimeAttentionTargetBounds(target, visibleMeshes) {
  const bounds = target?.bounds;
  if (!bounds) return null;
  bounds.makeEmpty();
  const visibleSet = new Set(visibleMeshes || []);
  const groups = target?.groups?.length
    ? target.groups
    : [{
        meshes: target?.meshes?.length ? target.meshes : [...visibleSet],
        bounds: new THREE.Box3(),
      }];
  for (const group of groups) {
    group.bounds.makeEmpty();
    for (const mesh of group.meshes) {
      if (!visibleSet.has(mesh)) continue;
      mesh.updateWorldMatrix(true, false);
      runtimeAttentionMeshBounds.makeEmpty();
      if (mesh.isSkinnedMesh) {
        mesh.computeBoundingBox?.();
        if (mesh.boundingBox) runtimeAttentionMeshBounds.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
      } else if (mesh.isInstancedMesh) {
        mesh.computeBoundingBox?.();
        if (mesh.boundingBox) runtimeAttentionMeshBounds.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
      } else if (Array.isArray(mesh.morphTargetInfluences) && mesh.morphTargetInfluences.length) {
        runtimeAttentionMeshBounds.setFromObject(mesh, true);
      } else {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) runtimeAttentionMeshBounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      }
      if (!runtimeAttentionMeshBounds.isEmpty()) {
        group.bounds.union(runtimeAttentionMeshBounds);
        bounds.union(runtimeAttentionMeshBounds);
      }
    }
  }
  return bounds.isEmpty() ? null : bounds;
}

function runtimeAttentionTargetDistanceToPoint(target, point) {
  const activeBounds = (target?.groups || [])
    .map((group) => group.bounds)
    .filter((bounds) => bounds && !bounds.isEmpty());
  if (activeBounds.length) {
    return Math.min(...activeBounds.map((bounds) => bounds.distanceToPoint(point)));
  }
  return target?.bounds && !target.bounds.isEmpty()
    ? target.bounds.distanceToPoint(point)
    : Infinity;
}

function createRuntimeAttentionArrow(marker) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.105);
  shape.lineTo(-0.052, 0.018);
  shape.lineTo(-0.021, 0.018);
  shape.lineTo(-0.021, -0.085);
  shape.lineTo(0.021, -0.085);
  shape.lineTo(0.021, 0.018);
  shape.lineTo(0.052, 0.018);
  shape.closePath();
  const material = new THREE.MeshBasicMaterial({
    color: 0xe5aa63,
    transparent: true,
    opacity: 0.86,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  mesh.renderOrder = 10_000;
  mesh.frustumCulled = false;
  mesh.userData.storyvrRuntimeAttentionArrow = true;
  const arrow = new THREE.Group();
  arrow.name = `StoryVR attention arrow · ${marker?.id || "target"}`;
  arrow.userData.storyvrRuntimeAttentionArrow = true;
  arrow.frustumCulled = false;
  arrow.add(mesh);
  arrow.visible = false;
  return arrow;
}

function disposeRuntimeAttentionArrow(arrow) {
  if (!arrow) return;
  arrow.removeFromParent();
  arrow.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material].filter(Boolean);
    for (const material of materials) material.dispose?.();
  });
}

function createRuntimeInvestigationTexture(kind) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return null;
  if (kind === "flare") {
    context.translate(64, 64);
    const diamond = (radiusX, radiusY, color) => {
      context.beginPath();
      context.moveTo(0, -radiusY);
      context.lineTo(radiusX, 0);
      context.lineTo(0, radiusY);
      context.lineTo(-radiusX, 0);
      context.closePath();
      context.fillStyle = color;
      context.fill();
    };
    diamond(12, 62, "rgba(255, 211, 108, 0.16)");
    diamond(62, 12, "rgba(255, 211, 108, 0.16)");
    diamond(6, 52, "rgba(255, 245, 203, 0.72)");
    diamond(52, 6, "rgba(255, 245, 203, 0.72)");
    diamond(3, 35, "rgba(255, 255, 247, 1)");
    diamond(35, 3, "rgba(255, 255, 247, 1)");
    const core = context.createRadialGradient(0, 0, 0, 0, 0, 18);
    core.addColorStop(0, "rgba(255, 255, 255, 1)");
    core.addColorStop(0.25, "rgba(255, 247, 207, 0.98)");
    core.addColorStop(1, "rgba(255, 201, 83, 0)");
    context.fillStyle = core;
    context.fillRect(-18, -18, 36, 36);
  } else {
    const innerRadius = kind === "mote" ? 1 : 5;
    const outerRadius = kind === "mote" ? 58 : 64;
    const gradient = context.createRadialGradient(64, 64, innerRadius, 64, 64, outerRadius);
    gradient.addColorStop(0, "rgba(255, 255, 250, 1)");
    gradient.addColorStop(0.12, "rgba(255, 247, 206, 0.98)");
    gradient.addColorStop(kind === "mote" ? 0.34 : 0.28, "rgba(255, 196, 73, 0.72)");
    gradient.addColorStop(kind === "mote" ? 0.7 : 0.62, "rgba(255, 161, 43, 0.2)");
    gradient.addColorStop(1, "rgba(255, 152, 28, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createRuntimeAttentionSparkle(groupIndex = 0) {
  const bloomTexture = createRuntimeInvestigationTexture("bloom");
  const flareTexture = createRuntimeInvestigationTexture("flare");
  const moteTexture = createRuntimeInvestigationTexture("mote");
  if (!bloomTexture || !flareTexture || !moteTexture) {
    bloomTexture?.dispose?.();
    flareTexture?.dispose?.();
    moteTexture?.dispose?.();
    return null;
  }
  const root = new THREE.Group();
  root.name = "StoryVR investigation sparkle";
  root.userData.storyvrAttentionEffect = true;
  root.frustumCulled = false;
  root.visible = false;

  const createSprite = (texture, color, opacity, blending = THREE.AdditiveBlending) => {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color,
      transparent: true,
      opacity,
      blending,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.userData.storyvrAttentionEffect = true;
    sprite.renderOrder = 3_000;
    sprite.frustumCulled = false;
    root.add(sprite);
    return sprite;
  };

  const bloom = createSprite(bloomTexture, 0xffbd52, 0.76, THREE.NormalBlending);
  const shaft = createSprite(bloomTexture, 0xffd06d, 0.46);
  const flare = createSprite(flareTexture, 0xffffea, 1);
  const flareSecondary = createSprite(flareTexture, 0xffcf65, 0.82);
  const motes = Array.from({ length: 7 }, (_, index) => {
    const mote = createSprite(moteTexture, index % 2 ? 0xffec9b : 0xffffff, 0.8);
    mote.userData.storyvrMoteIndex = index;
    return mote;
  });
  scene.add(root);
  return {
    root,
    bloom,
    shaft,
    flare,
    flareSecondary,
    motes,
    materials: [bloom.material, shaft.material, flare.material, flareSecondary.material, ...motes.map((mote) => mote.material)],
    textures: [bloomTexture, flareTexture, moteTexture],
    elapsedSeconds: 0,
    phase: groupIndex * 1.61803398875,
  };
}

function syncRuntimeAttentionSparkle(
  effect,
  bounds,
  visible,
  deltaSeconds = 1 / 60,
  configuredOpacity = ATTENTION_GLOW_OPACITY,
) {
  if (!effect?.root) return;
  effect.root.visible = Boolean(visible);
  if (!visible || !bounds || bounds.isEmpty()) return;
  effect.elapsedSeconds += THREE.MathUtils.clamp(Number(deltaSeconds) || 0, 0, 0.1);
  const time = effect.elapsedSeconds + effect.phase;
  const pulse = (Math.sin(time * 5.4) + 1) * 0.5;
  const intensity = THREE.MathUtils.clamp(
    0.78 + THREE.MathUtils.clamp(Number(configuredOpacity) || 0, 0, 1) * 0.22,
    0.78,
    1,
  );
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const effectScale = THREE.MathUtils.clamp(sphere.radius * 0.52, 0.22, 0.48);
  effect.root.position.set(
    sphere.center.x,
    bounds.max.y + THREE.MathUtils.clamp(sphere.radius * 0.14, 0.05, 0.16),
    sphere.center.z,
  );
  effect.root.scale.setScalar(effectScale);

  const bloomScale = 1.55 + pulse * 0.28;
  effect.bloom.scale.set(bloomScale, bloomScale, 1);
  effect.bloom.material.opacity = (0.68 + pulse * 0.18) * intensity;
  effect.shaft.scale.set(0.42 + pulse * 0.08, 2.3 + pulse * 0.3, 1);
  effect.shaft.material.opacity = (0.34 + pulse * 0.2) * intensity;
  const flareScale = 1.08 + pulse * 0.18;
  effect.flare.scale.set(flareScale, flareScale, 1);
  effect.flare.material.opacity = (0.9 + pulse * 0.1) * intensity;
  effect.flare.material.rotation = time * 0.42;
  const secondaryPulse = (Math.sin(time * 7.1 + 1.7) + 1) * 0.5;
  const secondaryScale = 0.66 + secondaryPulse * 0.26;
  effect.flareSecondary.scale.set(secondaryScale, secondaryScale, 1);
  effect.flareSecondary.material.opacity = (0.5 + secondaryPulse * 0.42) * intensity;
  effect.flareSecondary.material.rotation = -time * 0.68 + Math.PI / 4;

  for (let index = 0; index < effect.motes.length; index += 1) {
    const mote = effect.motes[index];
    const cycle = ((time * (0.3 + (index % 3) * 0.035)) + index / effect.motes.length) % 1;
    const angle = time * (0.72 + (index % 2) * 0.18) + index * 2.399963;
    const radius = 0.42 + (index % 3) * 0.1;
    const life = Math.sin(Math.PI * cycle);
    mote.position.set(
      Math.cos(angle) * radius,
      -0.48 + cycle * 1.52,
      Math.sin(angle) * radius * 0.34,
    );
    const moteScale = 0.1 + life * (0.13 + (index % 2) * 0.04);
    mote.scale.set(moteScale, moteScale, 1);
    mote.material.opacity = (0.18 + life * 0.82) * intensity;
  }
}

function applyRuntimeAttentionSparkles(target, enabled = true, deltaSeconds = 1 / 60) {
  const configuredOpacity = runtimeAttentionGuidance.readerGuidance?.glow?.opacity || ATTENTION_GLOW_OPACITY;
  for (let index = 0; index < (target?.groups || []).length; index += 1) {
    const group = target.groups[index];
    const visible = enabled && group.bounds && !group.bounds.isEmpty();
    if (visible && !group.investigationEffect) {
      group.investigationEffect = createRuntimeAttentionSparkle(index);
    }
    if (group.investigationEffect) {
      syncRuntimeAttentionSparkle(
        group.investigationEffect,
        group.bounds,
        visible,
        deltaSeconds,
        configuredOpacity,
      );
    }
  }
}

function disposeRuntimeAttentionSparkle(effect) {
  if (!effect) return;
  effect.root?.removeFromParent?.();
  for (const material of effect.materials || []) material?.dispose?.();
  for (const texture of effect.textures || []) texture?.dispose?.();
}

function restoreRuntimeAttentionEffect(target) {
  for (const group of target?.groups || []) {
    disposeRuntimeAttentionSparkle(group.investigationEffect);
    group.investigationEffect = null;
  }
}

function runtimeAttentionViewerCamera(renderCamera = activeRenderCamera()) {
  if (!renderer.xr.isPresenting) return renderCamera;
  renderCamera.updateWorldMatrix(true, false);
  renderer.xr.updateCamera(renderCamera);
  return renderer.xr.getCamera();
}

function runtimeAttentionTargetInFieldOfView(bounds, viewerCamera) {
  if (!bounds || bounds.isEmpty() || !viewerCamera?.projectionMatrix || !viewerCamera?.matrixWorld) return false;
  viewerCamera.matrixWorldInverse.copy(viewerCamera.matrixWorld).invert();
  runtimeAttentionProjectionMatrix.multiplyMatrices(viewerCamera.projectionMatrix, viewerCamera.matrixWorldInverse);
  runtimeAttentionFrustum.setFromProjectionMatrix(runtimeAttentionProjectionMatrix);
  return runtimeAttentionFrustum.intersectsBox(bounds);
}

function smoothAttentionArrowAngle(previousAngle, nextAngle, deltaSeconds) {
  if (!Number.isFinite(nextAngle)) return Number.isFinite(previousAngle) ? previousAngle : 0;
  const normalizedNext = Math.atan2(Math.sin(nextAngle), Math.cos(nextAngle));
  if (!Number.isFinite(previousAngle)) return normalizedNext;
  const delta = Math.max(0, Math.min(Number(deltaSeconds) || 0, 0.1));
  if (!delta) return previousAngle;
  const difference = Math.atan2(
    Math.sin(normalizedNext - previousAngle),
    Math.cos(normalizedNext - previousAngle),
  );
  const responseStep = difference * (1 - Math.exp(-ATTENTION_ARROW_DIRECTION_RESPONSE * delta));
  const maximumStep = ATTENTION_ARROW_MAX_ANGULAR_SPEED_RADIANS_PER_SECOND * delta;
  const next = previousAngle + Math.max(-maximumStep, Math.min(maximumStep, responseStep));
  return Math.atan2(Math.sin(next), Math.cos(next));
}

function positionRuntimeAttentionArrow(
  target,
  indicatorCamera,
  viewerCamera,
  targetIndex = 0,
  deltaSeconds = 1 / 60,
) {
  const arrow = target?.arrow;
  const bounds = target?.bounds;
  if (!arrow || !bounds || bounds.isEmpty() || !indicatorCamera || !viewerCamera) return false;
  if (arrow.parent !== scene) scene.add(arrow);
  indicatorCamera.updateWorldMatrix(true, false);
  const manualPosition = target.marker?.manual === true ? finiteAttentionPoint(target.marker.position) : null;
  if (manualPosition) {
    runtimeAttentionArrowTarget.set(manualPosition.x, manualPosition.y, manualPosition.z);
    modelRoot.localToWorld(runtimeAttentionArrowTarget);
  } else bounds.getCenter(runtimeAttentionArrowTarget);
  runtimeAttentionArrowNdc.copy(runtimeAttentionArrowTarget).project(viewerCamera);
  runtimeAttentionArrowLocalTarget.copy(runtimeAttentionArrowTarget);
  indicatorCamera.worldToLocal(runtimeAttentionArrowLocalTarget);
  let x = runtimeAttentionArrowNdc.x;
  let y = runtimeAttentionArrowNdc.y;
  if (
    runtimeAttentionArrowLocalTarget.z >= -0.001
    || !Number.isFinite(x)
    || !Number.isFinite(y)
  ) {
    x = runtimeAttentionArrowLocalTarget.x;
    y = runtimeAttentionArrowLocalTarget.y;
  }
  const previousAngle = Number(arrow.userData.storyvrAttentionArrowAngle);
  if (Math.abs(x) + Math.abs(y) < 0.0001) {
    x = Number.isFinite(previousAngle) ? Math.cos(previousAngle) : 1;
    y = Number.isFinite(previousAngle) ? Math.sin(previousAngle) : 0;
  }
  const smoothedAngle = smoothAttentionArrowAngle(previousAngle, Math.atan2(y, x), deltaSeconds);
  arrow.userData.storyvrAttentionArrowAngle = smoothedAngle;
  x = Math.cos(smoothedAngle);
  y = Math.sin(smoothedAngle);
  const edgeScale = ATTENTION_ARROW_EDGE_NDC / Math.max(Math.abs(x), Math.abs(y), 0.0001);
  x *= edgeScale;
  y *= edgeScale;
  const lane = ((Math.max(0, targetIndex) % 3) - 1) * 0.035;
  const length = Math.hypot(x, y) || 1;
  const laneX = (-y / length) * lane;
  const laneY = (x / length) * lane;
  x = Math.max(-0.79, Math.min(0.79, x + laneX));
  y = Math.max(-0.79, Math.min(0.79, y + laneY));
  runtimeAttentionArrowNdc.set(x, y, 0).unproject(indicatorCamera);
  indicatorCamera.getWorldPosition(runtimeAttentionArrowCameraPosition);
  runtimeAttentionArrowWorld.copy(runtimeAttentionArrowNdc)
    .sub(runtimeAttentionArrowCameraPosition)
    .normalize()
    .multiplyScalar(ATTENTION_ARROW_DISTANCE_METERS)
    .add(runtimeAttentionArrowCameraPosition);
  arrow.position.copy(runtimeAttentionArrowWorld);
  indicatorCamera.getWorldQuaternion(runtimeAttentionArrowCameraQuaternion);
  arrow.quaternion.copy(runtimeAttentionArrowCameraQuaternion);
  arrow.rotateZ(Math.atan2(y, x) - Math.PI / 2);
  runtimeAttentionArrowLocalTarget.copy(arrow.position);
  indicatorCamera.worldToLocal(runtimeAttentionArrowLocalTarget);
  const cameraDepth = Math.max(0.01, -runtimeAttentionArrowLocalTarget.z);
  const projection = indicatorCamera.projectionMatrix?.elements || [];
  const maxNdcPerWorldMeter = Math.max(
    Math.abs(Number(projection[0]) || 0),
    Math.abs(Number(projection[5]) || 0),
  ) / cameraDepth;
  const safeScale = maxNdcPerWorldMeter > 0
    ? ATTENTION_ARROW_RADIUS_NDC / (ATTENTION_ARROW_RADIUS_METERS * maxNdcPerWorldMeter)
    : 1;
  arrow.scale.setScalar(Math.max(0.01, Math.min(1, safeScale)));
  return true;
}

function clearRuntimeAttentionCues() {
  for (const target of activeRuntimeAttentionTargets) {
    restoreRuntimeAttentionEffect(target);
    disposeRuntimeAttentionArrow(target.arrow);
    target.arrow = null;
  }
  activeRuntimeAttentionTargets.length = 0;
}

function activateRuntimeAttentionGuidance(attentionScene = activeAttentionGuidance) {
  clearRuntimeAttentionCues();
  if (
    !runtimeAttentionGuidance.readerGuidance
    || !attentionScene
    || attentionScene.evaluated !== true
    || !Array.isArray(attentionScene.markers)
  ) return 0;
  for (const marker of attentionScene.markers) {
    const target = resolveRuntimeAttentionTarget(attentionScene, marker);
    if (!target || completedRuntimeAttentionKeys.has(target.key)) continue;
    target.arrow = createRuntimeAttentionArrow(marker);
    activeRuntimeAttentionTargets.push(target);
  }
  return activeRuntimeAttentionTargets.length;
}

function completeRuntimeAttentionTarget(target) {
  if (!target || target.completed) return;
  target.completed = true;
  completedRuntimeAttentionKeys.add(target.key);
  restoreRuntimeAttentionEffect(target);
  if (target.arrow) target.arrow.visible = false;
}

function updateRuntimeAttentionGuidance(renderCamera = activeRenderCamera(), deltaSeconds = 1 / 60) {
  if (!activeRuntimeAttentionTargets.length) return;
  modelRoot.updateWorldMatrix(true, true);
  const viewerCamera = runtimeAttentionViewerCamera(renderCamera);
  const indicatorCamera = viewerCamera;
  if (!viewerCamera || !indicatorCamera) return;
  viewerCamera.getWorldPosition(runtimeAttentionViewerPosition);
  const policy = runtimeAttentionGuidance.readerGuidance;
  if (!policy) return;
  for (let targetIndex = 0; targetIndex < activeRuntimeAttentionTargets.length; targetIndex += 1) {
    const target = activeRuntimeAttentionTargets[targetIndex];
    const completed = target.completed || completedRuntimeAttentionKeys.has(target.key);
    const visibleMeshes = completed
      ? []
      : target.meshes.filter((mesh) => runtimeAttentionMeshIsVisible(
        mesh,
        target.rootsByMesh?.get(mesh) || target.root,
      ));
    const bounds = runtimeAttentionTargetBounds(target, visibleMeshes);
    const targetVisible = Boolean(bounds);
    const distanceToBounds = bounds
      ? runtimeAttentionTargetDistanceToPoint(target, runtimeAttentionViewerPosition)
      : Infinity;
    const inFieldOfView = bounds ? runtimeAttentionTargetInFieldOfView(bounds, viewerCamera) : false;
    const decision = attentionCueFrameDecision({
      completed,
      targetVisible,
      distanceToBounds,
      completionDistanceMeters: policy.completion.distanceMeters,
      inFieldOfView,
    });
    if (decision.shouldComplete) {
      completeRuntimeAttentionTarget(target);
      continue;
    }
    applyRuntimeAttentionSparkles(
      target,
      decision.showGlow && policy.glow.enabled,
      deltaSeconds,
    );
    if (!target.arrow) continue;
    target.arrow.visible = Boolean(decision.showArrow && policy.arrow.enabled);
    if (!target.arrow.visible) {
      delete target.arrow.userData.storyvrAttentionArrowAngle;
      continue;
    }
    if (!positionRuntimeAttentionArrow(
      target,
      indicatorCamera,
      viewerCamera,
      targetIndex,
      deltaSeconds,
    )) {
      target.arrow.visible = false;
    }
  }
}

function runtimeSpatialSceneEntityIndex(
  beat = beats[activeIndex],
  index = activeIndex,
  variantOption = runtimeVariantOptionForGroup(runtimeVariantGroupForBeat(beat)),
) {
  const sceneRecord = runtimeSpatialSceneForBeat(beat, index, variantOption);
  return spatialEntityIndex(sceneRecord?.entities || sceneRecord);
}

function runtimeSpatialEntity(
  entityId,
  beat = beats[activeIndex],
  index = activeIndex,
  variantOption = runtimeVariantOptionForGroup(runtimeVariantGroupForBeat(beat)),
) {
  if (!entityId) return null;
  const sceneEntities = runtimeSpatialSceneEntityIndex(beat, index, variantOption);
  return sceneEntities?.[entityId]
    || runtimeSpatialRelations.entities?.[entityId]
    || null;
}

function runtimeGlbSpatialEntity(
  asset,
  beat = beats[activeIndex],
  index = activeIndex,
  variantOption = runtimeVariantOptionForGroup(runtimeVariantGroupForBeat(beat)),
) {
  if (!asset?.id) return null;
  const variantOptionId = String(variantOption?.id || variantOption?.optionId || "").trim();
  const beatScopedIds = [
    variantOptionId && `glb:${asset.id}:beat:${beat?.id}:variant:${variantOptionId}`,
    `glb:${asset.id}:beat:${beat?.id}`,
    `beat:${beat?.id}:glb:${asset.id}`,
    `${beat?.id}:glb:${asset.id}`,
  ].filter(Boolean);
  for (const entityId of beatScopedIds) {
    const entity = runtimeSpatialEntity(entityId, beat, index, variantOption);
    if (entity) return entity;
  }
  return runtimeSpatialEntity(`glb:${asset.id}`, beat, index, variantOption);
}

function finiteSpatialArray(value, length, fallback) {
  const list = Array.isArray(value) ? value.map(Number) : [];
  return list.length === length && list.every(Number.isFinite) ? list : [...fallback];
}

function normalizedSpatialTransform(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    position: finiteSpatialArray(source.position, 3, [0, 0, 0]),
    quaternion: normalizedSpatialQuaternion(source.quaternion, [0, 0, 0, 1]),
    scale: finiteSpatialArray(source.scale, 3, [1, 1, 1]).map((item) => Math.max(0.001, Math.min(100, item))),
  };
}

function normalizedSpatialQuaternion(value, fallback = [0, 0, 0, 1]) {
  const quaternion = finiteSpatialArray(value, 4, fallback);
  const length = Math.hypot(...quaternion);
  if (length < 1e-6) return [...fallback];
  return quaternion.map((item) => item / length);
}

function effectiveSpatialEntityTransform(entity) {
  return normalizedSpatialTransform(entity?.transform || entity?.effectiveTransform || entity?.inferredTransform);
}

function spatialTextEntityForBeat(
  beat,
  index = beats.findIndex((candidate) => candidate?.id === beat?.id),
  variantOption = runtimeVariantOptionForGroup(runtimeVariantGroupForBeat(beat)),
) {
  if (!beat?.id) return null;
  const variantOptionId = String(variantOption?.id || variantOption?.optionId || "").trim();
  return (variantOptionId
    ? runtimeSpatialEntity(`text-panel:${beat.id}:variant:${variantOptionId}`, beat, index, variantOption)
    : null)
    || runtimeSpatialEntity(`text-panel:${beat.id}`, beat, index, variantOption);
}

function spatialReaderEntityForBeat(
  beat,
  index = beats.findIndex((candidate) => candidate?.id === beat?.id),
) {
  if (!beat?.id) return null;
  return runtimeSpatialEntity(`reader:beat:${beat.id}`, beat, index);
}

function runtimeSceneUsesBeatSpatialAssets(scene) {
  return Boolean(scene && (
    /^storyvr-spatial-relations\/v2(?:$|[.-])/.test(runtimeSpatialRelations.schemaVersion)
    || scene.sceneKey
    || scene.sceneId
    || Array.isArray(scene.linkedAssetIds)
  ));
}

function spatialAssetIdFromEntity(entity) {
  const declared = String(entity?.assetId || entity?.sourceAssetId || entity?.asset?.id || "").trim();
  if (declared) return declared;
  const entityId = String(entity?.id || entity?.entityId || "");
  const match = entityId.match(/^(?:glb|image|image-plane):(.+?)(?::beat:|:variant:|$)/);
  return match?.[1] || "";
}

function spatialRenderableEntityKind(entity) {
  const kind = String(entity?.kind || entity?.type || "").toLowerCase();
  const entityId = String(entity?.id || entity?.entityId || "").toLowerCase();
  if (["glb", "gltf", "model", "model-asset"].includes(kind) || entityId.startsWith("glb:")) return "model";
  if (["image", "image-plane", "texture", "image-asset"].includes(kind) || /^(?:image|image-plane):/.test(entityId)) return "image";
  return "";
}

function runtimeLinkedAssetIndexForBeat(beat, variantOption = null) {
  const graphBeat = graphBeats.get(beat?.id);
  const inlineAssets = [
    ...(Array.isArray(beat?.linkedAssets) ? beat.linkedAssets : []),
    ...(Array.isArray(graphBeat?.linkedAssets) ? graphBeat.linkedAssets : []),
  ].filter((asset) => asset && typeof asset === "object" && asset.id);
  const byId = new Map((runtime.assets || []).filter((asset) => asset?.id).map((asset) => [asset.id, asset]));
  for (const asset of inlineAssets) byId.set(asset.id, { ...(byId.get(asset.id) || {}), ...asset });
  for (const assetId of uniqueStrings([
    ...(Array.isArray(beat?.linkedAssetIds) ? beat.linkedAssetIds : []),
    ...(Array.isArray(graphBeat?.linkedAssetIds) ? graphBeat.linkedAssetIds : []),
    ...(Array.isArray(variantOption?.assetIds) ? variantOption.assetIds : []),
    ...(Array.isArray(variantOption?.asset_ids) ? variantOption.asset_ids : []),
  ])) {
    if (!byId.has(assetId)) byId.set(assetId, { id: assetId });
  }
  return byId;
}

function spatialAssetEntriesForScene(sceneRecord, assetIndex) {
  const linkedAssetIds = new Set(uniqueStrings(sceneRecord?.linkedAssetIds || []));
  const entries = [];
  for (const entity of Object.values(spatialEntityIndex(sceneRecord?.entities))) {
    const kind = spatialRenderableEntityKind(entity);
    const assetId = spatialAssetIdFromEntity(entity);
    if (!kind || !assetId || (linkedAssetIds.size && !linkedAssetIds.has(assetId))) continue;
    const asset = assetIndex.get(assetId) || null;
    if (!asset || !asset.path) continue;
    if (kind === "model" && !isModelAsset(asset)) continue;
    if (kind === "image" && !isImageAsset(asset)) continue;
    entries.push({ kind, asset, entity });
  }
  return entries;
}

function runtimeSpatialAssetEntriesForBeat(
  beat,
  index = beats.findIndex((candidate) => candidate?.id === beat?.id),
  variantOption = runtimeVariantOptionForGroup(runtimeVariantGroupForBeat(beat)),
) {
  const sceneRecord = runtimeSpatialSceneForBeat(beat, index, variantOption);
  if (!runtimeSceneUsesBeatSpatialAssets(sceneRecord)) return [];
  const assetIndex = runtimeLinkedAssetIndexForBeat(beat, variantOption);
  return spatialAssetEntriesForScene(sceneRecord, assetIndex);
}

function spatialTextPlacementFromEntity(entity) {
  if (!entity) return null;
  const transform = effectiveSpatialEntityTransform(entity);
  const anchor = entity.anchor && typeof entity.anchor === "object" ? entity.anchor : {};
  const panel = entity.panel && typeof entity.panel === "object" ? entity.panel : {};
  const anchorType = anchor.type || anchor.space;
  const coordinateSpace = ["world", "reader", "asset", "source-focus"].includes(anchorType)
    ? anchorType
    : ["world", "reader", "asset", "source-focus"].includes(entity.coordinateSpace)
      ? entity.coordinateSpace
      : "world";
  const clearanceEnabled = ["asset", "source-focus"].includes(coordinateSpace) && Boolean(anchor.assetId || entity.assetId);
  return {
    coordinateSpace,
    position: { x: transform.position[0], y: transform.position[1], z: transform.position[2] },
    quaternion: transform.quaternion,
    rotation: { x: 0, y: 0, z: 0 },
    scaleVector: transform.scale,
    scale: transform.scale[0],
    width: Number.isFinite(Number(panel.width)) ? Number(panel.width) : 1.35,
    height: Number.isFinite(Number(panel.height)) ? Number(panel.height) : 0.72,
    orientationPolicy: String(entity.orientationPolicy || "fixed"),
    facesReader: ["yaw-to-reader", "billboard", "reader-facing-yaw", "reader-facing"].includes(entity.orientationPolicy),
    anchorAssetId: anchor.assetId || entity.assetId || null,
    anchorSource: anchor.source || anchorType || "manual",
    sourceCueId: anchor.sourceCueId || anchor.cueId || null,
    clearance: normalizeRuntimeTextPanelClearance(entity.clearance, clearanceEnabled),
  };
}

function normalizeRuntimeTextPanelClearance(value, enabledFallback = false) {
  const source = value && typeof value === "object" ? value : {};
  const number = (candidate, fallback, minimum, maximum) => {
    const parsed = Number(candidate);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback));
  };
  return {
    enabled: source.enabled === undefined ? Boolean(enabledFallback) : source.enabled === true,
    strategy: "visible-bounds-push-v2",
    minSurfaceDistance: number(source.minSurfaceDistance, 0.14, 0.02, 0.75),
    maxPushDistance: number(source.maxPushDistance, 5, 0.1, 5),
    sampleGrid: Math.round(number(source.sampleGrid, 5, 2, 5)),
    recheckIntervalMs: Math.round(number(source.recheckIntervalMs, 250, 50, 1000)),
  };
}

function normalizeRuntimeTextComfort(value, decision) {
  const source = value && typeof value === "object" ? value : {};
  return {
    policy: String(source.policy || decision?.option?.label || "Fixed panel"),
    placement: source.placement || decision?.textPlacement || null,
  };
}

function runtimeTextPlacementForBeat(beat, index = activeIndex) {
  const spatialPlacement = spatialTextPlacementFromEntity(spatialTextEntityForBeat(beat, index));
  if (spatialPlacement) return spatialPlacement;
  const timelinePlacement = runtime.timeline?.[index]?.textPlacement;
  const placement = timelinePlacement
    || runtimeTextComfort.placement?.overridesByBeat?.[beat?.id]
    || runtimeTextComfort.placement?.globalDefault
    || null;
  const pathMode = runtimeTextComfort.policy === "Path / object-attached text";
  const fallback = pathMode
    ? { coordinateSpace: "source-focus", position: { x: 0.42, y: 0.3, z: 0.06 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1, width: 1.35, height: 0.72, facesReader: true, anchorSource: "source-camera-focus" }
    : { coordinateSpace: "world", position: { x: -1.05, y: 1.48, z: -1.18 }, rotation: { x: 0, y: 0.36, z: 0 }, scale: 1, width: 1.35, height: 0.72, facesReader: false, anchorSource: "manual" };
  const sourcePlacement = placement && typeof placement === "object" ? placement : fallback;
  return {
    ...fallback,
    ...sourcePlacement,
    position: { ...fallback.position, ...(sourcePlacement.position || {}) },
    rotation: { ...fallback.rotation, ...(sourcePlacement.rotation || {}) },
  };
}

function runtimeSourceSpatialCueForBeat(beatId, assetId = null) {
  return sourceSpatialCues.cues.find((cue) => cue.beatId === beatId && (!assetId || cue.assetId === assetId))
    || sourceSpatialCues.cues.find((cue) => cue.beatId === beatId)
    || null;
}

function firstModelBeatIndex() {
  const index = beats.findIndex((beat) => modelAssetForBeat(beat));
  return index >= 0 ? index : 0;
}

function firstTraversalBeatIndex() {
  if (![...runtimeInteractionControl.boundaries, ...runtimeInteractionControl.routes]
    .some((boundary) => isReaderLocomotionInteraction(boundary))) {
    return firstModelBeatIndex();
  }
  const firstBeatId = runtimeSpatialTraversal.orderedStations[0]?.beatId;
  const index = beats.findIndex((beat) => beatIdentitySet(beat).has(firstBeatId));
  return index >= 0 ? index : firstModelBeatIndex();
}

function runtimeProgressionRouteMatchesBeatChange(route, fromBeat, toBeat) {
  const normalized = normalizeRuntimeProgressionRoute(route);
  if (!normalized || !fromBeat || !toBeat) return false;
  return runtimeBeatIdentityValues(fromBeat).includes(normalized.fromBeatId)
    && runtimeBeatIdentityValues(toBeat).includes(normalized.toBeatId);
}

function runtimeProgressionRouteFromCandidates(routes, fromBeat, toBeat, variantGroup = null, variantOption = null) {
  const matching = (Array.isArray(routes) ? routes : [])
    .map((route) => normalizeRuntimeProgressionRoute(route))
    .filter((route) => runtimeProgressionRouteMatchesBeatChange(route, fromBeat, toBeat));
  const optionId = String(variantOption?.id || variantOption?.optionId || variantOption || "").trim();
  const groupId = String(variantGroup?.id || variantGroup?.variantGroupId || variantGroup || "").trim();
  if (optionId) {
    const exact = matching.find((route) => (
      route.fromContext?.variantOptionId === optionId
      && (!route.fromContext?.variantGroupId || !groupId || route.fromContext.variantGroupId === groupId)
    ));
    if (exact) return exact;
    return matching.find((route) => !route.fromContext?.variantOptionId) || null;
  }
  return matching.find((route) => !route.fromContext?.variantOptionId) || matching[0] || null;
}

function runtimeProgressionRouteHistoryKey(fromIndex, toIndex) {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return "";
  return `${Math.min(fromIndex, toIndex)}->${Math.max(fromIndex, toIndex)}`;
}

function runtimeProgressionRouteForBeatChange(fromIndex, toIndex) {
  const fromBeat = beats[fromIndex];
  const toBeat = beats[toIndex];
  if (!fromBeat || !toBeat || toIndex - fromIndex !== 1) return null;
  const group = runtimeVariantGroupForBeat(fromBeat);
  const option = runtimeVariantOptionForGroup(group);
  return runtimeProgressionRouteFromCandidates(runtimeProgressionRoutes, fromBeat, toBeat, group, option);
}

function runtimeProgressionRouteForNavigation(fromIndex, toIndex) {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || Math.abs(toIndex - fromIndex) !== 1) return null;
  const historyKey = runtimeProgressionRouteHistoryKey(fromIndex, toIndex);
  if (toIndex < fromIndex) {
    return runtimeProgressionRouteHistory.get(historyKey)
      || runtimeProgressionRouteForBeatChange(toIndex, fromIndex);
  }
  return runtimeProgressionRouteForBeatChange(fromIndex, toIndex)
    || runtimeProgressionRouteHistory.get(historyKey)
    || null;
}

function runtimeInteractionForProgressionRoute(route) {
  if (!route) return null;
  return runtimeInteractionControl.routes.find((record) => runtimeProgressionRoutesMatch(record, route)) || null;
}

function rememberRuntimeProgressionRoute(route, fromIndex, toIndex) {
  const normalized = normalizeRuntimeProgressionRoute(route);
  const historyKey = runtimeProgressionRouteHistoryKey(fromIndex, toIndex);
  if (!normalized || !historyKey) return null;
  runtimeProgressionRouteHistory.set(historyKey, normalized);
  return normalized;
}

function applyRuntimeProgressionDestination(route, fromIndex, toIndex) {
  const normalized = normalizeRuntimeProgressionRoute(route);
  if (!normalized || fromIndex === toIndex) return;
  const forward = runtimeProgressionRouteMatchesBeatChange(normalized, beats[fromIndex], beats[toIndex]);
  const context = forward ? normalized.toContext : normalized.fromContext;
  const beat = beats[toIndex];
  const group = runtimeVariantGroupForBeat(beat);
  const optionId = String(context?.variantOptionId || "").trim();
  if (!group || !optionId || (context?.variantGroupId && context.variantGroupId !== group.id)) return;
  if (group.options.some((option) => option.id === optionId)) activeVariantOptionByGroupId.set(group.id, optionId);
}

function runtimeInteractionForBoundary(fromIndex, toIndex, route = null) {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || Math.abs(toIndex - fromIndex) !== 1) return null;
  const routeInteraction = runtimeInteractionForProgressionRoute(
    route || runtimeProgressionRouteForNavigation(fromIndex, toIndex),
  );
  if (routeInteraction) return routeInteraction;
  const forwardIndex = Math.min(fromIndex, toIndex);
  return runtimeInteractionControl.boundaries[forwardIndex] || null;
}

function isControllerButtonInteraction(boundary) {
  return normalizeRuntimeInteractionPolicy(boundary?.effectivePolicy || boundary) === "Controller button press";
}

function isDirectManipulationInteraction(record) {
  const policy = record?.effectivePolicy || record;
  return normalizeRuntimeInteractionPolicy(policy) === "Direct manipulation";
}

function runtimeInteractionConfiguration(record) {
  return record?.configuration && typeof record.configuration === "object" && !Array.isArray(record.configuration)
    ? record.configuration
    : null;
}

function runtimeControllerBindingForInput(boundary, handedness, control) {
  if (!isControllerButtonInteraction(boundary)) return null;
  const configuration = runtimeInteractionConfiguration(boundary);
  if (!configuration || !Array.isArray(configuration.bindings)) return null;
  const normalizedHand = String(handedness || "any").toLowerCase();
  const normalizedControl = normalizeRuntimeControllerControl(control);
  if (XR_RESERVED_CONTROLLER_CONTROLS.has(normalizedControl)) return null;
  return configuration.bindings.find((binding) => {
    const bindingHand = String(binding?.hand || binding?.handedness || "any").toLowerCase();
    const bindingInput = normalizeRuntimeControllerControl(binding?.input || binding?.control);
    return !XR_RESERVED_CONTROLLER_CONTROLS.has(bindingInput)
      && (bindingHand === "any" || bindingHand === normalizedHand)
      && bindingInput === normalizedControl;
  }) || null;
}

function configuredControllerActionForInput(handedness, control) {
  const outgoing = runtimeInteractionForBoundary(activeIndex, activeIndex + 1);
  const incoming = runtimeInteractionForBoundary(activeIndex - 1, activeIndex);
  if (isControllerButtonInteraction(outgoing) && Array.isArray(runtimeInteractionConfiguration(outgoing)?.bindings)) {
    const outgoingBinding = runtimeControllerBindingForInput(outgoing, handedness, control);
    return normalizeRuntimeControllerAction(outgoingBinding?.action);
  }
  const incomingBinding = runtimeControllerBindingForInput(incoming, handedness, control);
  const incomingAction = normalizeRuntimeControllerAction(incomingBinding?.action);
  if (incomingBinding && incomingAction === "previous-beat") return incomingAction;
  return "unmapped";
}

function questGamepadButtonIndex(control, handedness) {
  const normalizedControl = normalizeRuntimeControllerControl(control);
  if (normalizedControl === "trigger") return 0;
  if (normalizedControl === "grip") return 1;
  if (normalizedControl === "thumbstick-press") return 3;
  if (normalizedControl === "a" && handedness === "right") return 4;
  if (normalizedControl === "b" && handedness === "right") return 5;
  if (normalizedControl === "x" && handedness === "left") return 4;
  if (normalizedControl === "y" && handedness === "left") return 5;
  if (normalizedControl === "menu" && handedness === "left") return 6;
  return -1;
}

function runtimeThumbstickAxes(gamepad) {
  const axes = Array.from(gamepad?.axes || [], (value) => Number(value) || 0);
  if (axes.length >= 4) return [axes[axes.length - 2], axes[axes.length - 1]];
  if (axes.length >= 2) return [axes[0], axes[1]];
  return [0, 0];
}

function runtimeControllerControlPressed(gamepad, control, handedness, wasPressed = false) {
  const normalizedControl = normalizeRuntimeControllerControl(control);
  const buttonIndex = questGamepadButtonIndex(normalizedControl, handedness);
  if (buttonIndex >= 0) {
    const button = gamepad?.buttons?.[buttonIndex];
    const value = Math.max(Number(button?.value) || 0, button?.pressed ? 1 : 0);
    return value >= (wasPressed ? XR_GAMEPAD_BUTTON_RELEASE_THRESHOLD : XR_GAMEPAD_BUTTON_PRESS_THRESHOLD);
  }
  const [axisX, axisY] = runtimeThumbstickAxes(gamepad);
  const threshold = wasPressed ? XR_THUMBSTICK_RELEASE_THRESHOLD : XR_THUMBSTICK_PRESS_THRESHOLD;
  if (normalizedControl === "thumbstick-left") return axisX <= -threshold;
  if (normalizedControl === "thumbstick-right") return axisX >= threshold;
  if (normalizedControl === "thumbstick-up") return axisY <= -threshold;
  if (normalizedControl === "thumbstick-down") return axisY >= threshold;
  return false;
}

function performRuntimeControllerAction(action) {
  const normalizedAction = normalizeRuntimeControllerAction(action);
  if (controllerAdvancePending) return false;
  let destinationIndex = null;
  if (normalizedAction === "next-beat" && activeIndex < beats.length - 1) destinationIndex = activeIndex + 1;
  if (normalizedAction === "previous-beat" && activeIndex > 0) destinationIndex = activeIndex - 1;
  if (destinationIndex != null) {
    const route = runtimeProgressionRouteForNavigation(activeIndex, destinationIndex);
    controllerAdvancePending = true;
    Promise.resolve(setBeat(destinationIndex, { route })).finally(() => {
      controllerAdvancePending = false;
    });
    return true;
  }
  const group = runtimeVariantGroupForBeat(beats[activeIndex]);
  if (group && ["next-option", "previous-option"].includes(normalizedAction)) {
    const current = runtimeVariantOptionForGroup(group);
    const next = runtimeVariantSteppedOption(group, current, normalizedAction === "next-option" ? 1 : -1);
    if (!next) return false;
    activeVariantOptionByGroupId.set(group.id, next.id);
    setBeat(activeIndex);
    return true;
  }
  return false;
}

function handleConfiguredControllerInput(entry, control) {
  const action = configuredControllerActionForInput(entry?.handedness, control);
  if (action === "unmapped") return false;
  return performRuntimeControllerAction(action);
}

function updateConfiguredControllerInteractions() {
  const controls = [
    "thumbstick-press",
    "thumbstick-up",
    "thumbstick-down",
    "thumbstick-left",
    "thumbstick-right",
    "a",
    "b",
    "x",
    "y",
    "menu",
  ];
  for (const entry of xrTextPanelControllers.values()) {
    if (!xrControllerEntryOwnsHand(entry)) continue;
    const gamepad = entry.inputSource?.gamepad;
    if (!gamepad) continue;
    entry.gamepadInputState ||= new Map();
    for (const control of controls) {
      const previous = entry.gamepadInputState.get(control) === true;
      const pressed = runtimeControllerControlPressed(gamepad, control, entry.handedness, previous);
      entry.gamepadInputState.set(control, pressed);
      if (pressed && !previous) handleConfiguredControllerInput(entry, control);
    }
  }
}

function isReaderLocomotionInteraction(boundary) {
  return normalizeRuntimeInteractionPolicy(boundary?.effectivePolicy || boundary) === "Reader locomotion";
}

function runtimeBoundaryLocomotionMode(boundary) {
  return normalizeRuntimeLocomotionMode(boundary?.locomotionMode || runtimeSpatialTraversal.locomotionMode);
}

function runtimeLocomotionTolerance(record) {
  const tolerance = runtimeInteractionConfiguration(record)?.tolerance || {};
  const distance = Number(tolerance.distanceMeters);
  const dwell = Number(tolerance.dwellSeconds);
  return {
    distanceMeters: Number.isFinite(distance) && distance > 0
      ? distance
      : DEFAULT_LOCOMOTION_DISTANCE_METERS,
    dwellSeconds: Number.isFinite(dwell) && dwell >= 0
      ? dwell
      : DEFAULT_LOCOMOTION_DWELL_SECONDS,
  };
}

function runtimeConfiguredLocomotionStation(record, fromIndex, toIndex) {
  const configuration = runtimeInteractionConfiguration(record);
  const destination = configuration?.destination;
  if (!destination?.transform || !isReaderLocomotionInteraction(record)) return null;
  const sourceBeat = beats[fromIndex];
  const sourceStation = authoredReaderStationForBeat(sourceBeat, fromIndex);
  const sourcePosition = worldReaderPositionForStation(sourceStation)
    || (renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera).getWorldPosition(new THREE.Vector3());
  const sourceQuaternion = worldReaderQuaternionForStation(sourceStation)
    || (renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera).getWorldQuaternion(new THREE.Quaternion());
  return {
    stationId: `interaction:${record.boundaryId || record.edgeId || `${fromIndex}->${toIndex}`}`,
    beatId: String(beats[toIndex]?.id || sourceBeat?.id || ""),
    coordinateSpace: String(destination.coordinateSpace || "world").toLowerCase(),
    readerPosition: finiteInteractionArray(destination.transform.position, 3, [0, 0, 0]),
    readerQuaternion: finiteInteractionArray(destination.transform.quaternion, 4, [0, 0, 0, 1]),
    readerStartWorldPosition: sourcePosition.toArray(),
    readerStartWorldQuaternion: sourceQuaternion.toArray(),
    configured: true,
  };
}

function runtimeLocomotionStationForBoundary(record, fromIndex, toIndex) {
  return runtimeConfiguredLocomotionStation(record, fromIndex, toIndex)
    || traversalStationForBeat(beats[toIndex]);
}

function isPhysicalLocomotionBoundary(boundary) {
  return isReaderLocomotionInteraction(boundary) && runtimeBoundaryLocomotionMode(boundary) === "physical-walking";
}

function requiresPhysicalLocomotionBetween(fromIndex, toIndex) {
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  for (let index = start; index < end; index += 1) {
    if (isPhysicalLocomotionBoundary(runtimeInteractionForBoundary(index, index + 1))) return true;
  }
  return false;
}

function configureXrInteractionControllers() {
  for (let index = 0; index < 2; index += 1) {
    const controller = renderer.xr.getController(index);
    const grip = renderer.xr.getControllerGrip(index);
    controller.name = `storyvr-interaction-controller-${index + 1}`;
    grip.name = `storyvr-interaction-grip-${index + 1}`;
    controller.userData.index = index;
    controller.userData.handedness = index === 0 ? "left" : "right";
    controller.add(createXrTextPanelRay());
    const entry = {
      index,
      controller,
      grip,
      anchor: controller,
      handedness: controller.userData.handedness,
      connected: false,
      connectionOrder: 0,
      controllerModel: null,
      controllerModelInput: null,
      controllerModelInputSource: null,
    };
    xrTextPanelControllers.set(controller, entry);
    controller.addEventListener("connected", (event) => handleXrTextPanelControllerConnected(entry, event));
    controller.addEventListener("disconnected", (event) => handleXrTextPanelControllerDisconnected(entry, event));
    controller.addEventListener("selectstart", (event) => handleXrTextPanelSelectStart(entry, event));
    controller.addEventListener("selectend", () => handleXrTextPanelSelectEnd(entry));
    controller.addEventListener("squeezestart", () => handleXrTextPanelSqueezeStart(entry));
    controller.addEventListener("squeezeend", () => handleXrTextPanelSqueezeEnd(entry));
    controller.addEventListener("select", handleXrControllerSelect);
    readerRig.add(controller);
    readerRig.add(grip);
  }
}

function attachXrControllerVisual(entry) {
  if (!entry?.inputSource || !xrControllerEntryOwnsHand(entry)) return null;
  if (entry.controllerModel && entry.controllerModelInputSource === entry.inputSource) {
    return entry.controllerModel;
  }
  detachXrControllerVisual(entry);
  const controllerModelInput = new THREE.Group();
  controllerModelInput.name = `storyvr-controller-model-input-${entry.index + 1}`;
  const controllerModel = xrControllerModelFactory.createControllerModel(controllerModelInput);
  controllerModel.name = `storyvr-meta-quest-3-controller-${entry.index + 1}`;
  controllerModel.visible = false;
  entry.controllerModelInput = controllerModelInput;
  entry.controllerModelInputSource = entry.inputSource;
  entry.controllerModel = controllerModel;
  entry.grip.add(controllerModel);
  controllerModelInput.dispatchEvent({ type: "connected", data: entry.inputSource });
  return controllerModel;
}

function detachXrControllerVisual(entry) {
  if (!entry) return false;
  if (entry.controllerModelInput && entry.controllerModelInputSource) {
    entry.controllerModelInput.dispatchEvent({
      type: "disconnected",
      data: entry.controllerModelInputSource,
    });
  }
  entry.controllerModel?.removeFromParent?.();
  entry.controllerModel = null;
  entry.controllerModelInput = null;
  entry.controllerModelInputSource = null;
  return true;
}

function xrControllerHandOwner(entries, handedness, preferredEntry = null) {
  const candidates = [...entries].filter((entry) => (
    entry?.connected && entry.handedness === handedness
  ));
  if (preferredEntry && candidates.includes(preferredEntry)) return preferredEntry;
  return candidates.reduce((owner, candidate) => {
    if (!owner) return candidate;
    const candidateOrder = Number(candidate.connectionOrder) || 0;
    const ownerOrder = Number(owner.connectionOrder) || 0;
    if (candidateOrder !== ownerOrder) return candidateOrder > ownerOrder ? candidate : owner;
    return Number(candidate.index) < Number(owner.index) ? candidate : owner;
  }, null);
}

function xrControllerEntryOwnsHand(entry) {
  return Boolean(
    entry?.connected
    && xrTextPanelControllersByHand.get(entry.handedness) === entry,
  );
}

function deactivateXrControllerHandEntry(entry) {
  if (!entry) return false;
  if (xrDirectManipulationEntryIsActive(entry)) cancelXrDirectManipulation();
  if (xrTextPanelGrabEntry === entry) {
    xrTextPanelGrabEntry = null;
    xrTextPanelGrabInput = null;
  }
  if (xrTextPanelAttachedEntry === entry) xrTextPanelAttachedEntry = null;
  if (xrTextPanelScrollGesture?.entry === entry) xrTextPanelScrollGesture = null;
  entry.gamepadInputState?.clear?.();
  setXrTextPanelRayState(entry, false);
  detachXrControllerVisual(entry);
  return true;
}

function reconcileXrControllerHand(handedness, preferredEntry = null) {
  const previousEntry = xrTextPanelControllersByHand.get(handedness) || null;
  const nextEntry = xrControllerHandOwner(
    xrTextPanelControllers.values(),
    handedness,
    preferredEntry,
  );
  if (previousEntry !== nextEntry) {
    if (previousEntry) deactivateXrControllerHandEntry(previousEntry);
    if (nextEntry) xrTextPanelControllersByHand.set(handedness, nextEntry);
    else xrTextPanelControllersByHand.delete(handedness);
  }
  if (nextEntry) attachXrControllerVisual(nextEntry);
  updateXrControllerVisuals();
  return nextEntry;
}

function updateXrControllerVisuals() {
  for (const entry of xrTextPanelControllers.values()) {
    const visible = Boolean(renderer.xr.isPresenting && xrControllerEntryOwnsHand(entry));
    if (entry.controllerModel) entry.controllerModel.visible = visible;
  }
}

function handleXrTextPanelControllerConnected(entry, event) {
  const previousHand = entry.handedness;
  const handedness = ["left", "right"].includes(event?.data?.handedness)
    ? event.data.handedness
    : (entry.index === 0 ? "left" : "right");
  entry.handedness = handedness;
  entry.connected = true;
  entry.inputSource = event?.data || null;
  entry.connectionOrder = ++xrControllerConnectionRevision;
  entry.gamepadInputState = new Map();
  entry.anchor = event?.data?.gripSpace ? entry.grip : entry.controller;
  entry.controller.userData.handedness = handedness;
  entry.controller.userData.inputSource = event?.data || null;
  if (previousHand !== handedness) reconcileXrControllerHand(previousHand);
  reconcileXrControllerHand(handedness, entry);
  attachSpatialTextPanelToPreferredHand();
}

function handleXrTextPanelControllerDisconnected(entry, event) {
  if (event?.data && entry.inputSource && event.data !== entry.inputSource) return false;
  const handedness = entry.handedness;
  entry.connected = false;
  if (xrTextPanelControllersByHand.get(handedness) === entry) {
    reconcileXrControllerHand(handedness);
  } else {
    deactivateXrControllerHandEntry(entry);
  }
  entry.inputSource = null;
  entry.controller.userData.inputSource = null;
  attachSpatialTextPanelToPreferredHand();
  return true;
}

function createXrTextPanelRay() {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -XR_TEXT_PANEL_RAY_LENGTH),
  ]);
  const material = new THREE.LineBasicMaterial({ color: 0x6ed8c2, transparent: true, opacity: 0.68 });
  const ray = new THREE.Line(geometry, material);
  ray.name = "storyvr-text-panel-ray";
  ray.visible = false;
  return ray;
}

function preferredXrTextPanelEntry() {
  const preferred = xrTextPanelControllersByHand.get(xrTextPanelPreferredHand);
  if (xrControllerEntryOwnsHand(preferred)) return preferred;
  const left = xrTextPanelControllersByHand.get("left");
  if (xrControllerEntryOwnsHand(left)) return left;
  const right = xrTextPanelControllersByHand.get("right");
  if (xrControllerEntryOwnsHand(right)) return right;
  return [...xrTextPanelControllers.values()].find(xrControllerEntryOwnsHand) || null;
}

function attachSpatialTextPanelToPreferredHand() {
  if (!spatialTextPanel || xrTextPanelGrabEntry) return false;
  const entry = preferredXrTextPanelEntry();
  if (!entry) {
    spatialTextPanel.visible = false;
    xrTextPanelAttachedEntry = null;
    return false;
  }
  attachSpatialTextPanelToEntry(entry);
  return true;
}

function attachSpatialTextPanelToEntry(entry) {
  if (!spatialTextPanel || !xrControllerEntryOwnsHand(entry)) return false;
  const anchor = entry.anchor || entry.grip || entry.controller;
  if (spatialTextPanel.parent !== anchor) anchor.add(spatialTextPanel);
  const side = entry.handedness === "right" ? -1 : 1;
  spatialTextPanel.position.set(0.105 * side, 0.115, -0.32);
  spatialTextPanel.rotation.set(-0.16, -0.12 * side, 0);
  spatialTextPanel.scale.set(1, 1, 1);
  spatialTextPanel.visible = renderer.xr.isPresenting;
  xrTextPanelAttachedEntry = entry;
  return true;
}

function xrTextPanelActiveHitRoot() {
  if (!spatialTextPanel) return null;
  return textPanelMinimized
    ? spatialTextPanel.userData.minimizedRoot || null
    : spatialTextPanel.userData.expandedRoot || null;
}

function xrTextPanelHit(entry) {
  if (!xrControllerEntryOwnsHand(entry) || !spatialTextPanel?.visible || entry === xrTextPanelAttachedEntry) return null;
  const target = xrTextPanelActiveHitRoot();
  if (!target?.visible) return null;
  target.updateWorldMatrix(true, true);
  entry.controller.updateWorldMatrix(true, false);
  xrTextPanelRayRotation.identity().extractRotation(entry.controller.matrixWorld);
  xrTextPanelRaycaster.ray.origin.setFromMatrixPosition(entry.controller.matrixWorld);
  xrTextPanelRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(xrTextPanelRayRotation).normalize();
  const hit = xrTextPanelRaycaster.intersectObject(target, true)[0] || null;
  if (!hit) return null;
  let object = hit.object;
  while (object && object !== target.parent) {
    if (object.userData?.storyvrTextPanelAction) {
      return {
        action: object.userData.storyvrTextPanelAction,
        disabled: object.userData.storyvrTextPanelDisabled === true,
        object,
        point: hit.point,
        uv: hit.uv?.clone?.() || hit.uv || null,
      };
    }
    object = object.parent;
  }
  return {
    action: textPanelMinimized ? "restore" : "scroll",
    object: hit.object,
    point: hit.point,
    uv: hit.uv?.clone?.() || hit.uv || null,
  };
}

function xrTextPanelScrollStartHit(entry) {
  const hit = xrTextPanelHit(entry);
  if (hit) return hit;
  if (
    xrControllerEntryOwnsHand(entry)
    && entry === xrTextPanelAttachedEntry
    && !textPanelMinimized
    && Number(spatialTextPanel?.userData?.textPagination?.maxScrollLine) > 0
  ) {
    return {
      action: "scroll",
      attachedController: true,
      disabled: false,
      object: spatialTextPanel?.userData?.contentMesh || null,
    };
  }
  return null;
}

function handleXrTextPanelSelectStart(entry) {
  if (!xrControllerEntryOwnsHand(entry)) return false;
  const hit = xrTextPanelScrollStartHit(entry);
  if (!hit) return false;
  xrTextPanelConsumedSelect.add(entry.controller);
  entry.gamepadInputState?.set?.("trigger", true);
  if (hit.action === "minimize") {
    setTextPanelMinimized(true);
    return true;
  }
  if (hit.action === "restore") {
    setTextPanelMinimized(false);
    return true;
  }
  if (hit.action === "variant-previous" || hit.action === "variant-next") {
    if (!hit.disabled) {
      const group = runtimeVariantGroupForBeat(beats[activeIndex]);
      if (group) stepRuntimeVariantOption(group, hit.action === "variant-next" ? 1 : -1);
    }
    return true;
  }
  if (hit.action === "scroll") return beginXrTextPanelScroll(entry, hit);
  return false;
}

function handleXrTextPanelSelectEnd(entry) {
  if (!xrControllerEntryOwnsHand(entry)) return false;
  entry.gamepadInputState?.set?.("trigger", false);
  if (xrTextPanelScrollGesture?.entry !== entry) return false;
  xrTextPanelScrollGesture = null;
  setXrTextPanelRayState(entry, false);
  return true;
}

function handleXrTextPanelSqueezeStart(entry) {
  if (!xrControllerEntryOwnsHand(entry)) return false;
  entry.gamepadInputState?.set?.("grip", true);
  if (xrTextPanelHit(entry)) return beginXrTextPanelGrab(entry, "squeeze");
  if (!beginXrDirectManipulation(entry)) return false;
  setXrTextPanelRayState(entry, true, "direct-manipulation");
  return true;
}

function handleXrTextPanelSqueezeEnd(entry) {
  if (!xrControllerEntryOwnsHand(entry)) return false;
  entry.gamepadInputState?.set?.("grip", false);
  if (xrDirectManipulationEntryIsActive(entry)) {
    endXrDirectManipulation(entry);
    setXrTextPanelRayState(entry, false);
    return true;
  }
  if (xrTextPanelGrabEntry !== entry || xrTextPanelGrabInput !== "squeeze") return false;
  return endXrTextPanelGrab(entry);
}

function beginXrTextPanelScroll(entry, hit) {
  const content = spatialTextPanel?.userData?.textContent;
  const pagination = spatialTextPanel?.userData?.textPagination;
  if (!xrControllerEntryOwnsHand(entry) || hit?.action !== "scroll" || !content || !pagination) return false;
  entry.controller.updateMatrixWorld(true, false);
  const controllerPosition = entry.controller.getWorldPosition(new THREE.Vector3());
  xrTextPanelScrollGesture = {
    entry,
    startControllerY: controllerPosition.y,
    startLine: Number(content.scrollLine) || 0,
    maxScrollLine: Math.max(Number(pagination.maxScrollLine) || 0, 0),
  };
  setXrTextPanelRayState(entry, true, "scroll");
  return true;
}

function updateXrTextPanelScroll() {
  const gesture = xrTextPanelScrollGesture;
  if (!xrControllerEntryOwnsHand(gesture?.entry)) return false;
  gesture.entry.controller.updateMatrixWorld(true, false);
  const controllerPosition = gesture.entry.controller.getWorldPosition(new THREE.Vector3());
  return setRuntimeTextPanelScrollLine(runtimeTextPanelScrollLineFromVerticalDrag(
    gesture.startLine,
    gesture.startControllerY,
    controllerPosition.y,
    gesture.maxScrollLine,
    XR_TEXT_PANEL_HEIGHT,
  ));
}

function runtimeTextPanelScrollLineFromVerticalDrag(
  startLine,
  startControllerY,
  currentControllerY,
  maxScrollLine,
  panelHeight,
) {
  const maximum = Math.max(Number(maxScrollLine) || 0, 0);
  const normalizedDrag = ((Number(startControllerY) || 0) - (Number(currentControllerY) || 0))
    / Math.max(Number(panelHeight) || 0, 0.01);
  return THREE.MathUtils.clamp(
    Math.round((Number(startLine) || 0) + (normalizedDrag * maximum)),
    0,
    maximum,
  );
}

function beginXrTextPanelGrab(entry, input = "squeeze") {
  if (!xrControllerEntryOwnsHand(entry) || !spatialTextPanel || xrTextPanelGrabEntry) return false;
  xrTextPanelGrabEntry = entry;
  xrTextPanelGrabInput = input;
  entry.controller.attach(spatialTextPanel);
  setXrTextPanelRayState(entry, true, "grab");
  return true;
}

function endXrTextPanelGrab(entry) {
  if (xrTextPanelGrabEntry !== entry) return false;
  xrTextPanelPreferredHand = entry.handedness;
  xrTextPanelGrabEntry = null;
  xrTextPanelGrabInput = null;
  attachSpatialTextPanelToEntry(entry);
  setXrTextPanelRayState(entry, false);
  return true;
}

function updateXrTextPanelInteractionRays() {
  updateXrTextPanelScroll();
  for (const entry of xrTextPanelControllers.values()) {
    const hit = entry === xrTextPanelScrollGesture?.entry
      ? { action: "scroll" }
      : entry === xrTextPanelGrabEntry
      ? { action: "grab" }
      : xrDirectManipulationEntryIsActive(entry)
        ? { action: "direct-manipulation" }
        : xrTextPanelScrollStartHit(entry) || xrDirectManipulationHit(entry);
    setXrTextPanelRayState(entry, Boolean(hit), hit?.action || "", hit?.disabled === true);
  }
}

function setXrTextPanelRayState(entry, active, action = "", disabled = false) {
  const ray = entry?.controller?.getObjectByName("storyvr-text-panel-ray");
  if (!ray) return;
  ray.visible = Boolean(renderer.xr.isPresenting && xrControllerEntryOwnsHand(entry) && active);
  ray.material.color.setHex(disabled ? 0x76817d : action === "minimize" || action === "restore" ? 0xe5aa63 : 0x6ed8c2);
  ray.material.opacity = active ? 0.92 : 0.68;
}

function activeRuntimeDirectTargetRoots() {
  const roots = [];
  if (activeModel && activeModelAsset) {
    roots.push({
      assetId: String(activeModelAsset.id || ""),
      entityId: String(activeModelSpatialEntity?.id || activeModelSpatialEntity?.entityId || ""),
      root: modelAuthorTransformRoot,
      sceneRoot: activeModel,
    });
  }
  for (const entry of activeSupplementalModelEntries) {
    roots.push({
      assetId: String(entry.asset?.id || ""),
      entityId: String(entry.entity?.id || entry.entity?.entityId || ""),
      root: entry.authorTransformRoot,
      sceneRoot: entry.model,
    });
  }
  return roots;
}

function runtimeInteractionTargetsMatch(requested, available) {
  if (!requested || !available) return false;
  const requestedEntityId = String(requested.entityId || "");
  const requestedAssetId = String(requested.assetId || "");
  const availableEntityId = String(available.entityId || "");
  const availableAssetId = String(available.assetId || "");
  if (requestedEntityId && requestedEntityId !== availableEntityId) return false;
  if (requestedAssetId && requestedAssetId !== availableAssetId) return false;
  if (!requestedEntityId && !requestedAssetId) return false;
  const requestedNodeIndex = Number(requested.nodeIndex);
  const availableNodeIndex = Number(available.nodeIndex);
  const requestedHasNodeIndex = Number.isInteger(requestedNodeIndex) && requestedNodeIndex >= 0;
  const availableHasNodeIndex = Number.isInteger(availableNodeIndex) && availableNodeIndex >= 0;
  const requestedNodePath = String(requested.nodePath || "").replace(/^\/+|\/+$/g, "").toLowerCase();
  const availableNodePath = String(available.nodePath || "").replace(/^\/+|\/+$/g, "").toLowerCase();
  const requestedIsPart = requestedHasNodeIndex || Boolean(requestedNodePath);
  const availableIsPart = availableHasNodeIndex || Boolean(availableNodePath);
  if (requestedIsPart !== availableIsPart) return false;
  if (!requestedIsPart) return true;
  if (requestedHasNodeIndex && availableHasNodeIndex) return requestedNodeIndex === availableNodeIndex;
  return Boolean(requestedNodePath && availableNodePath && requestedNodePath === availableNodePath);
}

function runtimeDirectRootForTarget(target, candidates = activeRuntimeDirectTargetRoots()) {
  if (!target) return null;
  const interactionCandidates = candidates.filter((entry) => entry?.target);
  if (interactionCandidates.length) {
    return interactionCandidates.find((entry) => runtimeInteractionTargetsMatch(target, entry.target)) || null;
  }
  const assetId = String(target.assetId || "");
  const entityId = String(target.entityId || "");
  if (!assetId && !entityId) return null;
  const candidate = candidates.find((entry) => (
    (!assetId || entry.assetId === assetId)
    && (!entityId || entry.entityId === entityId)
  )) || null;
  if (!candidate) return null;
  const requestedNodeIndex = Number(target.nodeIndex);
  const hasNodeIndex = Number.isInteger(requestedNodeIndex) && requestedNodeIndex >= 0;
  const selector = String(target.nodePath || "").trim();
  if (!hasNodeIndex && !selector) return candidate;
  const normalizedSelector = selector.replace(/^\/+|\/+$/g, "").toLowerCase();
  const sceneRoot = candidate.sceneRoot;
  if (!sceneRoot?.traverse) return null;
  let indexed = null;
  const exact = [];
  const compatible = [];
  sceneRoot.traverse((object) => {
    if (!object?.parent || object.isBone || object.isSkinnedMesh) return;
    if (hasNodeIndex && Number(object.userData?.storyvrGltfNodeIndex) === requestedNodeIndex) indexed = object;
    if (!normalizedSelector) return;
    const path = sourcePartNodePath(object, sceneRoot).toLowerCase();
    if (path === normalizedSelector || String(object.name || "").toLowerCase() === normalizedSelector) exact.push(object);
    else if (sourcePartSelectorMatchesNode(selector, object, sceneRoot)) compatible.push(object);
  });
  const root = indexed || exact[0] || compatible[0] || null;
  return root ? {
    ...candidate,
    root,
    ...(selector ? { nodePath: selector } : {}),
    ...(hasNodeIndex ? { nodeIndex: requestedNodeIndex } : {}),
  } : null;
}

function runtimeInteractionPivotForCandidate(candidate, target) {
  if (!candidate?.root?.parent || target?.targetKind !== "node") {
    return candidate ? {
      ...candidate,
      originalParent: candidate.root?.parent || null,
      interactionObject: candidate.root || null,
      usesInteractionPivot: false,
    } : null;
  }
  const interactionObject = candidate.root;
  const originalParent = interactionObject.parent;
  const pivot = new THREE.Group();
  pivot.name = `storyvr-interaction-pivot:${target.nodeIndex ?? target.nodePath ?? interactionObject.name ?? "part"}`;
  pivot.userData.storyvrInteractionPivot = true;
  originalParent.add(pivot);
  pivot.add(interactionObject);
  return {
    ...candidate,
    root: pivot,
    originalParent,
    interactionObject,
    usesInteractionPivot: true,
  };
}

function configureRuntimeInBeatInteractionTargets() {
  activeRuntimeInBeatTargets.length = 0;
  const beat = beats[activeIndex];
  const variantGroup = runtimeVariantGroupForBeat(beat);
  const variantOption = runtimeVariantOptionForGroup(variantGroup);
  const spatialScene = runtimeSpatialSceneForBeat(beat, activeIndex, variantOption);
  const record = runtimeInBeatInteractionForScene(
    runtimeInBeatInteractions,
    spatialScene,
    beat,
    variantGroup,
    variantOption,
  );
  const candidates = activeRuntimeDirectTargetRoots();
  for (const target of record?.targets || []) {
    const resolved = runtimeDirectRootForTarget(target, candidates);
    const candidate = runtimeInteractionPivotForCandidate(resolved, target);
    if (!candidate?.root || !candidate.originalParent) continue;
    const entry = { ...candidate, target, record };
    candidate.root.userData.storyvrInBeatInteractionTarget = true;
    runtimeInteractionEntryByRoot.set(candidate.root, entry);
    activeRuntimeInBeatTargets.push(entry);
    clampRuntimeInteractionTarget(entry);
  }
  scene.userData.storyvrInBeatInteractions = record || null;
  return activeRuntimeInBeatTargets;
}

function runtimeInteractionEntryFor(root, value = null) {
  if (value?.root && value?.target) return value;
  const fromRoot = root && typeof runtimeInteractionEntryByRoot !== "undefined"
    ? runtimeInteractionEntryByRoot.get(root)
    : null;
  if (fromRoot?.root === root) return fromRoot;
  return value && typeof value === "object" ? { root, target: value, originalParent: root?.parent } : null;
}

function runtimeInteractionInitialMatrix(entry) {
  if (!entry?.usesInteractionPivot) return new THREE.Matrix4().identity();
  const initial = normalizeRuntimeTransform(entry.target?.initialTransform);
  return new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(initial.position),
    new THREE.Quaternion().fromArray(initial.quaternion).normalize(),
    new THREE.Vector3().fromArray(initial.scale),
  );
}

function runtimeInteractionRootMatrixRelativeTo(root, referenceParent) {
  root.updateWorldMatrix(true, false);
  if (!referenceParent) return root.matrixWorld.clone();
  referenceParent.updateWorldMatrix(true, false);
  return new THREE.Matrix4().copy(referenceParent.matrixWorld).invert().multiply(root.matrixWorld);
}

function runtimeInteractionLogicalTransform(root, value = null) {
  if (!root) return null;
  const entry = runtimeInteractionEntryFor(root, value);
  const referenceParent = entry?.originalParent || root.parent || null;
  const logicalMatrix = runtimeInteractionRootMatrixRelativeTo(root, referenceParent);
  if (entry?.usesInteractionPivot) logicalMatrix.multiply(runtimeInteractionInitialMatrix(entry));
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  logicalMatrix.decompose(position, quaternion, scale);
  return { position, quaternion: quaternion.normalize(), scale };
}

function applyRuntimeInteractionLogicalTransform(entry, transform) {
  const root = entry?.root;
  const referenceParent = entry?.originalParent || root?.parent || null;
  if (!root || !referenceParent || !transform) return false;
  const logicalMatrix = new THREE.Matrix4().compose(
    transform.position,
    transform.quaternion,
    transform.scale,
  );
  const rootMatrix = entry.usesInteractionPivot
    ? logicalMatrix.multiply(runtimeInteractionInitialMatrix(entry).invert())
    : logicalMatrix;
  referenceParent.updateWorldMatrix(true, false);
  const rootWorldMatrix = new THREE.Matrix4().multiplyMatrices(referenceParent.matrixWorld, rootMatrix);
  const currentParent = root.parent;
  if (currentParent) {
    currentParent.updateWorldMatrix(true, false);
    rootWorldMatrix.premultiply(new THREE.Matrix4().copy(currentParent.matrixWorld).invert());
  }
  rootWorldMatrix.decompose(root.position, root.quaternion, root.scale);
  root.quaternion.normalize();
  root.updateMatrixWorld(true);
  return true;
}

function runtimeInteractionEulerDegreesNearRange(quaternion, rotationRange) {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  const values = [euler.x, euler.y, euler.z].map(THREE.MathUtils.radToDeg);
  if (!rotationRange?.min || !rotationRange?.max) return values;
  const reference = values.map((_, axis) => (
    (Number(rotationRange.min[axis]) + Number(rotationRange.max[axis])) / 2
  ));
  if (!reference.every(Number.isFinite)) return values;
  const wrapNear = (value, target) => value + 360 * Math.round((target - value) / 360);
  const base = values.map((value, axis) => wrapNear(value, reference[axis]));
  const alternate = [values[0] + 180, 180 - values[1], values[2] + 180]
    .map((value, axis) => wrapNear(value, reference[axis]));
  const distance = (candidate) => candidate.reduce((sum, value, axis) => sum + (value - reference[axis]) ** 2, 0);
  return distance(alternate) < distance(base) ? alternate : base;
}

function clampRuntimeInteractionLogicalTransform(transform, constraints = {}) {
  if (!transform) return null;
  const position = transform.position.clone();
  const quaternion = transform.quaternion.clone().normalize();
  const scale = transform.scale.clone();
  if (constraints.position?.enabled) {
    position.fromArray(position.toArray().map((component, index) => THREE.MathUtils.clamp(
      component,
      constraints.position.min[index],
      constraints.position.max[index],
    )));
  }
  if (constraints.rotation?.enabled) {
    const degrees = runtimeInteractionEulerDegreesNearRange(quaternion, constraints.rotation);
    const clamped = degrees.map((component, index) => THREE.MathUtils.clamp(
      component,
      constraints.rotation.min[index],
      constraints.rotation.max[index],
    ));
    quaternion.setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(clamped[0]),
      THREE.MathUtils.degToRad(clamped[1]),
      THREE.MathUtils.degToRad(clamped[2]),
      "XYZ",
    )).normalize();
  }
  if (constraints.scale?.enabled) {
    scale.fromArray(scale.toArray().map((component, index) => THREE.MathUtils.clamp(
      component,
      constraints.scale.min[index],
      constraints.scale.max[index],
    )));
  }
  return { position, quaternion, scale };
}

function clampRuntimeInteractionTarget(entry) {
  const transform = runtimeInteractionLogicalTransform(entry?.root, entry);
  const clamped = clampRuntimeInteractionLogicalTransform(transform, entry?.target?.constraints);
  return clamped ? applyRuntimeInteractionLogicalTransform(entry, clamped) : false;
}

function runtimeInteractionReachableChannels(value = null) {
  const target = value?.target || value;
  if (!target || (target.oneHandGrabbable === undefined && target.twoHandScalable === undefined)) {
    return { position: true, rotation: true, scale: true };
  }
  return {
    position: target.oneHandGrabbable === true,
    rotation: target.oneHandGrabbable === true,
    scale: target.twoHandScalable === true,
  };
}

function runtimeDirectTransformError(root, target, interactable = null) {
  const destination = target?.destinationTransform;
  if (!root || !destination) return null;
  const targetPosition = new THREE.Vector3().fromArray(destination.position);
  const targetQuaternion = new THREE.Quaternion().fromArray(destination.quaternion).normalize();
  const targetScale = new THREE.Vector3().fromArray(destination.scale);
  const useLocalTransform = target.coordinateSpace === "local";
  root.updateWorldMatrix(true, true);
  const logical = useLocalTransform ? runtimeInteractionLogicalTransform(root, interactable) : null;
  const currentPosition = logical?.position || root.getWorldPosition(new THREE.Vector3());
  const currentQuaternion = logical?.quaternion || root.getWorldQuaternion(new THREE.Quaternion());
  const currentScale = logical?.scale || root.getWorldScale(new THREE.Vector3());
  const scaleError = Math.max(
    Math.abs(currentScale.x - targetScale.x) / Math.max(Math.abs(targetScale.x), 0.0001),
    Math.abs(currentScale.y - targetScale.y) / Math.max(Math.abs(targetScale.y), 0.0001),
    Math.abs(currentScale.z - targetScale.z) / Math.max(Math.abs(targetScale.z), 0.0001),
  );
  return {
    reachable: runtimeInteractionReachableChannels(interactable),
    positionMeters: currentPosition.distanceTo(targetPosition),
    rotationDegrees: THREE.MathUtils.radToDeg(currentQuaternion.angleTo(targetQuaternion)),
    scaleRatio: scaleError,
  };
}

function runtimeDirectTargetMatches(root, target, interactable = null) {
  const error = runtimeDirectTransformError(root, target, interactable);
  if (!error) return false;
  const tolerance = target.tolerance || {};
  const reachable = error.reachable;
  if (!reachable.position && !reachable.rotation && !reachable.scale) return false;
  return (!reachable.position || error.positionMeters <= (Number(tolerance.positionMeters) || DEFAULT_DIRECT_POSITION_TOLERANCE_METERS))
    && (!reachable.rotation || error.rotationDegrees <= (Number(tolerance.rotationDegrees) || DEFAULT_DIRECT_ROTATION_TOLERANCE_DEGREES))
    && (!reachable.scale || error.scaleRatio <= (Number(tolerance.scaleRatio) || DEFAULT_DIRECT_SCALE_TOLERANCE_RATIO));
}

function runtimeObjectWorldTransform(root) {
  if (!root) return null;
  root.updateWorldMatrix(true, true);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  root.matrixWorld.decompose(position, quaternion, scale);
  return { position, quaternion: quaternion.normalize(), scale };
}

function runtimeDirectDestinationWorldTransform(root, target, interactable = null) {
  const destination = target?.destinationTransform;
  if (!root || !destination) return null;
  const entry = runtimeInteractionEntryFor(root, interactable);
  const reachable = runtimeInteractionReachableChannels(entry || interactable);
  const current = target.coordinateSpace === "local"
    ? runtimeInteractionLogicalTransform(root, entry)
    : runtimeObjectWorldTransform(root);
  const position = reachable.position
    ? new THREE.Vector3().fromArray(destination.position)
    : current.position.clone();
  const quaternion = reachable.rotation
    ? new THREE.Quaternion().fromArray(destination.quaternion).normalize()
    : current.quaternion.clone();
  const scale = reachable.scale
    ? new THREE.Vector3().fromArray(destination.scale)
    : current.scale.clone();
  const matrix = new THREE.Matrix4().compose(position, quaternion, scale);
  if (target.coordinateSpace === "local") {
    if (entry?.usesInteractionPivot) matrix.multiply(runtimeInteractionInitialMatrix(entry).invert());
    const referenceParent = entry?.originalParent || root.parent;
    referenceParent?.updateWorldMatrix(true, false);
    if (referenceParent) matrix.premultiply(referenceParent.matrixWorld);
  }
  matrix.decompose(position, quaternion, scale);
  return { position, quaternion: quaternion.normalize(), scale };
}

function runtimeDirectGhostTravelSeconds(distanceMeters) {
  return THREE.MathUtils.clamp(
    Math.max(0, Number(distanceMeters) || 0) / DIRECT_GHOST_VELOCITY_METERS_PER_SECOND,
    DIRECT_GHOST_MIN_TRAVEL_SECONDS,
    DIRECT_GHOST_MAX_TRAVEL_SECONDS,
  );
}

function createRuntimeDirectGhostMaterial(sourceMaterial) {
  const material = sourceMaterial?.clone?.() || new THREE.MeshBasicMaterial({ color: 0x6ed8c2 });
  const sourceOpacity = Number.isFinite(Number(sourceMaterial?.opacity)) ? Number(sourceMaterial.opacity) : 1;
  material.transparent = true;
  material.opacity = Math.min(Math.max(sourceOpacity, 0), 1) * DIRECT_GHOST_OPACITY;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.toneMapped = false;
  material.fog = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  if (material.emissive?.isColor) {
    const glowColor = material.color?.isColor ? material.color.clone() : new THREE.Color(0x6ed8c2);
    glowColor.lerp(new THREE.Color(0x6ed8c2), 0.28);
    material.emissive.copy(glowColor);
    material.emissiveIntensity = Math.max(Number(material.emissiveIntensity) || 0, 0.38);
  }
  material.needsUpdate = true;
  return material;
}

function createRuntimeDirectGhostModel(root) {
  if (!root) return null;
  const ghost = cloneSkinnedObject(root);
  const materials = [];
  ghost.name = `StoryVR manipulation ghost · ${root.name || root.uuid}`;
  ghost.userData = { ...ghost.userData, storyvrDirectManipulationGhost: true };
  ghost.traverse((node) => {
    node.userData = { ...node.userData, storyvrDirectManipulationGhost: true };
    node.raycast = () => {};
    if (node.isCamera || node.isLight || node.isAudio) {
      node.visible = false;
      return;
    }
    if (!node.isMesh && !node.isLine && !node.isPoints) return;
    const sourceMaterials = Array.isArray(node.material)
      ? node.material
      : node.material ? [node.material] : [];
    const ghostMaterials = sourceMaterials.length
      ? sourceMaterials.map((material) => createRuntimeDirectGhostMaterial(material))
      : [createRuntimeDirectGhostMaterial(null)];
    materials.push(...ghostMaterials);
    node.material = Array.isArray(node.material) ? ghostMaterials : ghostMaterials[0];
    node.castShadow = false;
    node.receiveShadow = false;
    node.renderOrder = (Number(node.renderOrder) || 0) + 2;
  });
  return { ghost, materials };
}

function applyRuntimeDirectGhostTransform(object, transform) {
  if (!object || !transform) return;
  object.position.copy(transform.position);
  object.quaternion.copy(transform.quaternion);
  object.scale.copy(transform.scale);
  object.updateMatrixWorld(true);
}

function startRuntimeDirectManipulationCue(cue, startedAt = elapsedSeconds) {
  const start = runtimeObjectWorldTransform(cue?.root);
  const destination = runtimeDirectDestinationWorldTransform(cue?.root, cue?.target, cue?.interactable);
  if (!cue?.ghost || !start || !destination) return false;
  cue.start = start;
  cue.destination = destination;
  cue.travelSeconds = runtimeDirectGhostTravelSeconds(start.position.distanceTo(destination.position));
  cue.phase = "travel";
  cue.phaseStartedAt = startedAt;
  cue.ghost.visible = true;
  applyRuntimeDirectGhostTransform(cue.ghost, start);
  return true;
}

function createRuntimeDirectManipulationCue(root, target, interactable = null) {
  const result = createRuntimeDirectGhostModel(root);
  if (!result) return null;
  const cue = {
    root,
    target,
    interactable,
    ghost: result.ghost,
    materials: result.materials,
    phase: "idle",
    phaseStartedAt: elapsedSeconds,
    lastReaderInteractionAt: elapsedSeconds,
    start: null,
    destination: null,
    travelSeconds: DIRECT_GHOST_MIN_TRAVEL_SECONDS,
  };
  directManipulationCueRoot.add(cue.ghost);
  startRuntimeDirectManipulationCue(cue);
  return cue;
}

function runtimeDirectManipulationCueKey(root, target) {
  return [
    root?.uuid || "unknown-root",
    target?.coordinateSpace || "scene",
    target?.nodeIndex ?? "no-node-index",
    target?.nodePath || "whole-object",
    JSON.stringify(target?.destinationTransform || {}),
  ].join("|");
}

function suspendRuntimeDirectManipulationCue(cue, interactedAt = elapsedSeconds) {
  if (!cue) return;
  cue.lastReaderInteractionAt = interactedAt;
  cue.phase = "idle";
  cue.phaseStartedAt = interactedAt;
  if (cue.ghost) cue.ghost.visible = false;
}

function markRuntimeDirectManipulationActivity(root, interactedAt = elapsedSeconds) {
  for (const cue of activeRuntimeDirectCues) {
    if (cue.root === root) suspendRuntimeDirectManipulationCue(cue, interactedAt);
  }
}

function updateRuntimeDirectManipulationCues(now = elapsedSeconds) {
  for (const cue of activeRuntimeDirectCues) {
    if (!cue.ghost) continue;
    if (
      xrDirectManipulationGrab?.root === cue.root
      || (typeof xrDirectManipulationScale !== "undefined" && xrDirectManipulationScale?.root === cue.root)
    ) {
      suspendRuntimeDirectManipulationCue(cue, now);
      continue;
    }
    if (cue.phase === "idle") {
      const inactiveSince = Math.max(cue.phaseStartedAt, cue.lastReaderInteractionAt);
      if (now - inactiveSince >= DIRECT_GHOST_INACTIVITY_REPLAY_SECONDS) {
        startRuntimeDirectManipulationCue(cue, now);
      }
      continue;
    }
    if (cue.phase === "travel") {
      const progress = THREE.MathUtils.clamp((now - cue.phaseStartedAt) / cue.travelSeconds, 0, 1);
      const eased = THREE.MathUtils.smootherstep(progress, 0, 1);
      cue.ghost.position.lerpVectors(cue.start.position, cue.destination.position, eased);
      cue.ghost.quaternion.slerpQuaternions(cue.start.quaternion, cue.destination.quaternion, eased);
      cue.ghost.scale.lerpVectors(cue.start.scale, cue.destination.scale, eased);
      cue.ghost.updateMatrixWorld(true);
      if (progress >= 1) {
        applyRuntimeDirectGhostTransform(cue.ghost, cue.destination);
        cue.phase = "hold";
        cue.phaseStartedAt = now;
      }
      continue;
    }
    if (cue.phase === "hold" && now - cue.phaseStartedAt >= DIRECT_GHOST_DESTINATION_HOLD_SECONDS) {
      cue.ghost.visible = false;
      cue.phase = "idle";
      cue.phaseStartedAt = now;
    }
  }
}

function disposeRuntimeDirectManipulationCue(cue) {
  cue?.ghost?.removeFromParent();
  for (const material of cue?.materials || []) material.dispose?.();
  if (cue) {
    cue.ghost = null;
    cue.materials = [];
  }
}

function configureRuntimeDirectManipulation() {
  activeRuntimeDirectInteractions.length = 0;
  configureRuntimeInBeatInteractionTargets();
  const cueByKey = new Map();
  const outgoingRoute = runtimeProgressionRouteForNavigation(activeIndex, activeIndex + 1);
  const outgoingBoundary = runtimeInteractionForBoundary(activeIndex, activeIndex + 1, outgoingRoute);
  const records = [];
  if (isDirectManipulationInteraction(outgoingBoundary)) {
    records.push({
      kind: "beat",
      record: outgoingBoundary,
      destinationIndex: activeIndex + 1,
      route: outgoingRoute,
    });
  }
  const group = runtimeVariantGroupForBeat(beats[activeIndex]);
  const selectedOption = runtimeVariantOptionForGroup(group);
  for (const record of runtimeVariantInteractionsFromOption(group, selectedOption?.id)
    .filter((candidate) => isDirectManipulationInteraction(candidate))) {
    records.push({
      kind: "variant",
      record,
      variantGroup: group,
      toVariantOptionId: record.toVariantOptionId,
    });
  }
  for (const interaction of records) {
    const configuration = runtimeInteractionConfiguration(interaction.record);
    const targets = Array.isArray(configuration?.targets) ? configuration.targets : [];
    if (!targets.length) continue;
    const targetEntries = targets.flatMap((target) => {
      const candidate = runtimeDirectRootForTarget(target, activeRuntimeInBeatTargets);
      if (!candidate) return [];
      candidate.root.userData.storyvrDirectManipulationTarget = true;
      const cueKey = runtimeDirectManipulationCueKey(candidate.root, target);
      let cue = cueByKey.get(cueKey) || null;
      if (!cue) {
        cue = createRuntimeDirectManipulationCue(candidate.root, target, candidate);
        if (cue) {
          cueByKey.set(cueKey, cue);
          activeRuntimeDirectCues.push(cue);
        }
      }
      return [{ ...candidate, target, interactable: candidate, cue }];
    });
    if (!targetEntries.length) continue;
    activeRuntimeDirectInteractions.push({
      ...interaction,
      configuration,
      targetCount: targetEntries.length,
      targetEntries,
    });
  }
}

function xrDirectManipulationHit(entry) {
  if (!xrControllerEntryOwnsHand(entry) || !activeRuntimeInBeatTargets.length) return null;
  const roots = [...new Set(activeRuntimeInBeatTargets.map((targetEntry) => targetEntry.root))];
  if (!roots.length) return null;
  entry.controller.updateWorldMatrix(true, false);
  xrTextPanelRayRotation.identity().extractRotation(entry.controller.matrixWorld);
  xrTextPanelRaycaster.ray.origin.setFromMatrixPosition(entry.controller.matrixWorld);
  xrTextPanelRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(xrTextPanelRayRotation).normalize();
  const hit = xrTextPanelRaycaster.intersectObjects(roots, true)[0] || null;
  if (!hit) return null;
  const targetRoots = new Set(roots);
  let root = hit.object;
  while (root && !targetRoots.has(root)) root = root.parent;
  const targetEntry = activeRuntimeInBeatTargets.find((candidate) => candidate.root === root) || null;
  return root && targetEntry
    ? { action: "direct-manipulation", root, targetEntry, object: hit.object, point: hit.point }
    : null;
}

function runtimeControllerWorldPosition(entry) {
  entry?.controller?.updateWorldMatrix?.(true, false);
  return entry?.controller?.getWorldPosition?.(new THREE.Vector3()) || null;
}

function runtimeControllerRayDirection(entry) {
  entry?.controller?.updateWorldMatrix?.(true, false);
  if (!entry?.controller?.matrixWorld) return null;
  return new THREE.Vector3(0, 0, -1)
    .transformDirection(entry.controller.matrixWorld)
    .normalize();
}

function runtimeBimanualScaleRatio(startDistance, currentDistance) {
  const start = Math.max(0.0001, Number(startDistance) || 0);
  const current = Math.max(0, Number(currentDistance) || 0);
  return current / start;
}

function runtimeElasticDragGain(speedMetersPerSecond) {
  const progress = THREE.MathUtils.smoothstep(
    Math.max(0, Number(speedMetersPerSecond) || 0),
    ELASTIC_DRAG_MIN_SPEED_METERS_PER_SECOND,
    ELASTIC_DRAG_MAX_SPEED_METERS_PER_SECOND,
  );
  return 1 + ((ELASTIC_DRAG_MAX_POSITION_GAIN - 1) * progress);
}

function resetRuntimeElasticDragState(grab, now = elapsedSeconds) {
  if (!grab) return false;
  grab.elasticOffsetWorld = new THREE.Vector3();
  grab.elasticVelocityWorld = new THREE.Vector3();
  grab.elasticLastControllerPosition = runtimeControllerWorldPosition(grab.entry);
  grab.elasticLastRayDirection = runtimeControllerRayDirection(grab.entry);
  grab.elasticLastSampleAt = Number(now) || 0;
  return grab.targetEntry?.target?.elasticDragging === true
    && Boolean(grab.elasticLastControllerPosition)
    && Boolean(grab.elasticLastRayDirection);
}

function integrateRuntimeElasticDragVelocity(grab, targetVelocity, deltaSeconds) {
  if (
    !grab?.elasticOffsetWorld
    || !grab.elasticVelocityWorld
    || !targetVelocity
    || !(deltaSeconds > 0)
  ) return false;
  const responseSeconds = Math.max(0.001, ELASTIC_DRAG_INERTIA_SECONDS);
  const decay = Math.exp(-deltaSeconds / responseSeconds);
  const velocityDelta = grab.elasticVelocityWorld.clone().sub(targetVelocity);
  grab.elasticOffsetWorld
    .addScaledVector(targetVelocity, deltaSeconds)
    .addScaledVector(velocityDelta, responseSeconds * (1 - decay));
  grab.elasticVelocityWorld
    .copy(targetVelocity)
    .addScaledVector(velocityDelta, decay);
  return targetVelocity.lengthSq() > 0 || grab.elasticVelocityWorld.lengthSq() > 0;
}

function updateRuntimeElasticDragOffset(grab, now = elapsedSeconds) {
  if (
    grab?.targetEntry?.target?.elasticDragging !== true
    || !grab.elasticOffsetWorld
    || !grab.elasticVelocityWorld
  ) return false;
  const currentPosition = runtimeControllerWorldPosition(grab.entry);
  const rayDirection = runtimeControllerRayDirection(grab.entry);
  const previousPosition = grab.elasticLastControllerPosition;
  const previousRayDirection = grab.elasticLastRayDirection;
  const previousSampleAt = Number(grab.elasticLastSampleAt);
  grab.elasticLastControllerPosition = currentPosition;
  grab.elasticLastRayDirection = rayDirection;
  grab.elasticLastSampleAt = Number(now) || 0;
  if (!currentPosition || !rayDirection || !previousPosition || !Number.isFinite(previousSampleAt)) {
    grab.elasticVelocityWorld.set(0, 0, 0);
    return false;
  }
  const deltaSeconds = (Number(now) || 0) - previousSampleAt;
  if (deltaSeconds <= 0 || deltaSeconds > ELASTIC_DRAG_MAX_SAMPLE_SECONDS) {
    grab.elasticVelocityWorld.set(0, 0, 0);
    return false;
  }
  const controllerDelta = currentPosition.clone().sub(previousPosition);
  const distance = controllerDelta.length();
  if (distance > ELASTIC_DRAG_MAX_SAMPLE_DISTANCE_METERS) {
    grab.elasticVelocityWorld.set(0, 0, 0);
    return false;
  }
  if (previousRayDirection && grab.elasticVelocityWorld.lengthSq() > 0) {
    const offsetAlongPreviousRay = grab.elasticOffsetWorld.dot(previousRayDirection);
    const speedAlongPreviousRay = grab.elasticVelocityWorld.dot(previousRayDirection);
    grab.elasticOffsetWorld.copy(rayDirection).multiplyScalar(offsetAlongPreviousRay);
    grab.elasticVelocityWorld.copy(rayDirection).multiplyScalar(speedAlongPreviousRay);
  }
  const targetVelocity = grab.elasticVelocityWorld.clone();
  const distanceAlongRay = controllerDelta.dot(rayDirection);
  const axialDistance = Math.abs(distanceAlongRay);
  if (axialDistance >= ELASTIC_DRAG_MIN_SAMPLE_DISTANCE_METERS) {
    const gain = runtimeElasticDragGain(axialDistance / deltaSeconds);
    if (gain > 1) {
      targetVelocity
        .copy(rayDirection)
        .multiplyScalar((gain - 1) * distanceAlongRay / deltaSeconds)
        .clampLength(0, ELASTIC_DRAG_MAX_INERTIA_SPEED_METERS_PER_SECOND);
    }
  }
  return integrateRuntimeElasticDragVelocity(grab, targetVelocity, deltaSeconds);
}

function applyRuntimeElasticGrabOffset(grab) {
  if (
    grab?.targetEntry?.target?.elasticDragging !== true
    || !grab.elasticOffsetWorld
    || !grab.root?.parent
  ) return false;
  const desiredWorldPosition = grab.root
    .getWorldPosition(new THREE.Vector3())
    .add(grab.elasticOffsetWorld);
  grab.root.parent.worldToLocal(desiredWorldPosition);
  grab.root.position.copy(desiredWorldPosition);
  grab.root.updateMatrixWorld(true);
  return true;
}

function syncRuntimeElasticGrabOffset(grab) {
  if (
    grab?.targetEntry?.target?.elasticDragging !== true
    || !grab.elasticOffsetWorld
    || !grab.controllerMatrix
    || grab.root?.parent !== grab.entry?.controller
  ) return false;
  grab.entry.controller.updateWorldMatrix(true, false);
  const baseWorldPosition = new THREE.Vector3().setFromMatrixPosition(
    new THREE.Matrix4().multiplyMatrices(grab.entry.controller.matrixWorld, grab.controllerMatrix),
  );
  const previousOffset = grab.elasticOffsetWorld.clone();
  grab.elasticOffsetWorld.copy(
    grab.root.getWorldPosition(new THREE.Vector3()).sub(baseWorldPosition),
  );
  if (
    grab.elasticVelocityWorld
    && previousOffset.distanceToSquared(grab.elasticOffsetWorld) > 1e-10
  ) {
    grab.elasticVelocityWorld.set(0, 0, 0);
  }
  return true;
}

function captureRuntimeGrabControllerMatrix(grab) {
  if (!grab?.root || grab.root.parent !== grab.entry?.controller) return false;
  grab.root.updateMatrix();
  grab.controllerMatrix = grab.root.matrix.clone();
  resetRuntimeElasticDragState(grab);
  return true;
}

function applyRuntimeGrabControllerMatrix(grab) {
  if (!grab?.root || !grab.controllerMatrix || grab.root.parent !== grab.entry?.controller) return false;
  updateRuntimeElasticDragOffset(grab);
  grab.controllerMatrix.decompose(grab.root.position, grab.root.quaternion, grab.root.scale);
  grab.root.quaternion.normalize();
  grab.root.updateMatrixWorld(true);
  applyRuntimeElasticGrabOffset(grab);
  return true;
}

function xrDirectManipulationRootIsActive(root) {
  return Boolean(root && xrDirectManipulationGrab?.root === root);
}

function xrDirectManipulationEntryIsActive(entry) {
  return Boolean(
    entry
    && (xrDirectManipulationGrab?.entry === entry || xrDirectManipulationScale?.secondaryEntry === entry),
  );
}

function beginXrDirectManipulationScale(entry, hit) {
  const grab = xrDirectManipulationGrab;
  if (
    !grab
    || xrDirectManipulationScale
    || grab.entry === entry
    || hit?.root !== grab.root
    || grab.targetEntry?.target?.twoHandScalable !== true
  ) return false;
  if (grab.root.parent !== grab.originalParent) grab.originalParent.attach(grab.root);
  clampRuntimeInteractionTarget(grab.targetEntry);
  const primaryPosition = runtimeControllerWorldPosition(grab.entry);
  const secondaryPosition = runtimeControllerWorldPosition(entry);
  const startLogical = runtimeInteractionLogicalTransform(grab.root, grab.targetEntry);
  if (!primaryPosition || !secondaryPosition || !startLogical) return false;
  xrDirectManipulationScale = {
    primaryEntry: grab.entry,
    secondaryEntry: entry,
    root: grab.root,
    targetEntry: grab.targetEntry,
    startDistance: Math.max(primaryPosition.distanceTo(secondaryPosition), 0.0001),
    startLogical,
  };
  grab.mode = "scale";
  grab.secondaryEntry = entry;
  markRuntimeDirectManipulationActivity(grab.root);
  return true;
}

function beginXrDirectManipulation(entry) {
  const hit = xrDirectManipulationHit(entry);
  if (!hit?.root?.parent || !hit.targetEntry) return false;
  if (xrDirectManipulationGrab) return beginXrDirectManipulationScale(entry, hit);
  const target = hit.targetEntry.target;
  if (!target.oneHandGrabbable && !target.twoHandScalable) return false;
  xrDirectManipulationGrab = {
    entry,
    root: hit.root,
    originalParent: hit.targetEntry.originalParent || hit.root.parent,
    targetEntry: hit.targetEntry,
    mode: target.oneHandGrabbable ? "grab" : "armed-scale",
    secondaryEntry: null,
  };
  markRuntimeDirectManipulationActivity(hit.root);
  if (target.oneHandGrabbable) {
    entry.controller.attach(hit.root);
    captureRuntimeGrabControllerMatrix(xrDirectManipulationGrab);
  }
  return true;
}

function updateRuntimeDirectManipulation() {
  const grab = xrDirectManipulationGrab;
  if (!grab) return false;
  const scale = xrDirectManipulationScale;
  if (scale) {
    const primaryPosition = runtimeControllerWorldPosition(scale.primaryEntry);
    const secondaryPosition = runtimeControllerWorldPosition(scale.secondaryEntry);
    if (!primaryPosition || !secondaryPosition) return false;
    const ratio = runtimeBimanualScaleRatio(scale.startDistance, primaryPosition.distanceTo(secondaryPosition));
    const logical = {
      position: scale.startLogical.position.clone(),
      quaternion: scale.startLogical.quaternion.clone(),
      scale: scale.startLogical.scale.clone().multiplyScalar(ratio),
    };
    const clamped = clampRuntimeInteractionLogicalTransform(logical, scale.targetEntry.target.constraints);
    applyRuntimeInteractionLogicalTransform(scale.targetEntry, clamped);
    return true;
  }
  if (grab.mode === "grab") {
    applyRuntimeGrabControllerMatrix(grab);
    const clamped = clampRuntimeInteractionTarget(grab.targetEntry);
    syncRuntimeElasticGrabOffset(grab);
    return clamped;
  }
  return grab.mode === "armed-scale";
}

function endXrDirectManipulationScale(entry) {
  const scale = xrDirectManipulationScale;
  const grab = xrDirectManipulationGrab;
  if (!scale || !grab || (scale.primaryEntry !== entry && scale.secondaryEntry !== entry)) return false;
  updateRuntimeDirectManipulation();
  const remainingEntry = scale.primaryEntry === entry ? scale.secondaryEntry : scale.primaryEntry;
  xrDirectManipulationScale = null;
  grab.entry = remainingEntry;
  grab.secondaryEntry = null;
  if (grab.targetEntry.target.oneHandGrabbable && remainingEntry?.connected) {
    remainingEntry.controller.attach(grab.root);
    grab.mode = "grab";
    captureRuntimeGrabControllerMatrix(grab);
  } else {
    if (grab.root.parent !== grab.originalParent) grab.originalParent.attach(grab.root);
    grab.mode = "armed-scale";
  }
  clampRuntimeInteractionTarget(grab.targetEntry);
  markRuntimeDirectManipulationActivity(grab.root);
  return true;
}

function endXrDirectManipulation(entry, options = {}) {
  const grab = xrDirectManipulationGrab;
  if (!grab || !xrDirectManipulationEntryIsActive(entry)) return false;
  if (xrDirectManipulationScale) return endXrDirectManipulationScale(entry);
  if (grab.entry !== entry) return false;
  if (grab.root.parent !== grab.originalParent) grab.originalParent.attach(grab.root);
  clampRuntimeInteractionTarget(grab.targetEntry);
  xrDirectManipulationGrab = null;
  markRuntimeDirectManipulationActivity(grab.root);
  if (options.evaluate !== false) evaluateRuntimeDirectManipulationCompletion();
  return true;
}

function cancelXrDirectManipulation() {
  const grab = xrDirectManipulationGrab;
  if (!grab) return false;
  if (grab.root?.parent !== grab.originalParent) grab.originalParent?.attach?.(grab.root);
  clampRuntimeInteractionTarget(grab.targetEntry);
  xrDirectManipulationScale = null;
  xrDirectManipulationGrab = null;
  markRuntimeDirectManipulationActivity(grab.root);
  return true;
}

function runtimeDirectInteractionComplete(interaction) {
  if (!interaction?.targetCount || interaction.targetEntries.length !== interaction.targetCount) return false;
  const matches = interaction.targetEntries.map((entry) => runtimeDirectTargetMatches(
    entry.root,
    entry.target,
    entry.interactable,
  ));
  return interaction.configuration?.completion === "any" ? matches.some(Boolean) : matches.every(Boolean);
}

function evaluateRuntimeDirectManipulationCompletion() {
  if (directManipulationAdvancePending) return false;
  const interaction = activeRuntimeDirectInteractions.find((candidate) => runtimeDirectInteractionComplete(candidate));
  if (!interaction) return false;
  directManipulationAdvancePending = true;
  if (interaction.kind === "variant") {
    activeVariantOptionByGroupId.set(interaction.variantGroup.id, interaction.toVariantOptionId);
    Promise.resolve(setBeat(activeIndex)).finally(() => {
      directManipulationAdvancePending = false;
    });
    return true;
  }
  Promise.resolve(setBeat(interaction.destinationIndex, { route: interaction.route })).finally(() => {
    directManipulationAdvancePending = false;
  });
  return true;
}

function clearRuntimeDirectManipulation() {
  if (xrDirectManipulationGrab) {
    if (xrDirectManipulationGrab.root?.parent !== xrDirectManipulationGrab.originalParent) {
      xrDirectManipulationGrab.originalParent?.attach?.(xrDirectManipulationGrab.root);
    }
    clampRuntimeInteractionTarget(xrDirectManipulationGrab.targetEntry);
    xrDirectManipulationGrab = null;
  }
  xrDirectManipulationScale = null;
  for (const interaction of activeRuntimeDirectInteractions) {
    for (const entry of interaction.targetEntries) delete entry.root.userData.storyvrDirectManipulationTarget;
  }
  activeRuntimeDirectInteractions.length = 0;
  for (const cue of activeRuntimeDirectCues) disposeRuntimeDirectManipulationCue(cue);
  activeRuntimeDirectCues.length = 0;
  directManipulationCueRoot.clear();
  for (const entry of activeRuntimeInBeatTargets.splice(0)) {
    delete entry.root.userData.storyvrInBeatInteractionTarget;
    runtimeInteractionEntryByRoot.delete(entry.root);
    if (entry.usesInteractionPivot && entry.interactionObject?.parent === entry.root) {
      entry.originalParent?.attach?.(entry.interactionObject);
      entry.root.removeFromParent();
    }
  }
  scene.userData.storyvrInBeatInteractions = null;
}

function handleXrControllerSelect(event) {
  const controller = event?.currentTarget || event?.target || null;
  if (controller && xrTextPanelConsumedSelect.has(controller)) {
    xrTextPanelConsumedSelect.delete(controller);
    return true;
  }
  return false;
}

function buildBeatStrip() {
  beatStrip.innerHTML = beats.map((beat, index) => `
    <button
      class="${modelAssetForBeat(beat) ? "has-model" : ""}"
      type="button"
      data-beat-index="${index}"
      title="${escapeHtml(beat.title || beat.text || beat.id)}"
    >${String(index + 1).padStart(2, "0")}</button>
  `).join("");
  for (const button of beatStrip.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      const destinationIndex = Number(button.dataset.beatIndex);
      if (requiresPhysicalLocomotionBetween(activeIndex, destinationIndex)) return;
      setBeat(destinationIndex);
    });
  }
}

function configureTraversalControls() {
  const incoming = runtimeInteractionForBoundary(activeIndex - 1, activeIndex);
  const outgoing = runtimeInteractionForBoundary(activeIndex, activeIndex + 1);
  prevButton.hidden = isPhysicalLocomotionBoundary(incoming);
  nextButton.hidden = isPhysicalLocomotionBoundary(outgoing);
  prevButton.textContent = isReaderLocomotionInteraction(incoming) ? "Previous station" : "Previous beat";
  nextButton.textContent = isReaderLocomotionInteraction(outgoing) ? "Next station" : "Next beat";
  beatStrip.setAttribute("aria-label", "Story beats and authored interaction boundaries");
  for (const button of beatStrip.querySelectorAll("button")) {
    const destinationIndex = Number(button.dataset.beatIndex);
    button.disabled = requiresPhysicalLocomotionBetween(activeIndex, destinationIndex);
  }
}

function navigateInteraction(direction) {
  const destinationIndex = activeIndex + direction;
  if (destinationIndex < 0 || destinationIndex >= beats.length) return;
  const route = runtimeProgressionRouteForNavigation(activeIndex, destinationIndex);
  const boundary = runtimeInteractionForBoundary(activeIndex, destinationIndex, route);
  if (isPhysicalLocomotionBoundary(boundary)) return;
  setBeat(destinationIndex, { route });
}

async function setBeat(index) {
  if (!beats.length) return;
  const options = arguments[1] && typeof arguments[1] === "object" ? arguments[1] : {};
  const loadRevision = ++activeSceneLoadRevision;
  clearRuntimeDirectManipulation();
  clearRuntimeAttentionCues();
  const previousIndex = activeIndex;
  const destinationIndex = Math.max(0, Math.min(beats.length - 1, index));
  const progressionRoute = options.route || runtimeProgressionRouteForNavigation(previousIndex, destinationIndex);
  if (progressionRoute) {
    rememberRuntimeProgressionRoute(progressionRoute, previousIndex, destinationIndex);
    applyRuntimeProgressionDestination(progressionRoute, previousIndex, destinationIndex);
  }
  activeIndex = destinationIndex;
  const beat = beats[activeIndex];
  const graphBeat = graphBeats.get(beat.id);
  const variantGroup = runtimeVariantGroupForBeat(beat);
  const variantInteraction = runtimeVariantInteractionForBeat(beat, variantGroup);
  const variantOption = runtimeVariantOptionForGroup(variantGroup);
  const proceduralPlans = proceduralDynamicsRuntimePlansForBeat(beat, variantOption);
  scene.userData.storyvrVariantInteractionControls = runtimeVariantInteractionsFromOption(
    variantGroup,
    variantOption?.id,
  );
  const environmentResult = await switchRuntimeEnvironmentEnhancement(beat, loadRevision);
  if (environmentResult.reason === "stale" || loadRevision !== activeSceneLoadRevision) return;
  activeAttentionGuidance = exposeRuntimeAttentionGuidance(
    scene,
    runtimeAttentionGuidanceForBeat(beat, activeIndex, variantOption),
  );
  const sharedTimelinePlayback = sourceMotionSharedPlaybackForBeatChange(previousIndex, activeIndex, {
    initial: !activeModel,
    route: progressionRoute,
  });
  const sharedTimelineOwnsModel = sharedTimelineOwnsDestinationModel(sharedTimelinePlayback);
  const sharedTimelineAsset = sharedTimelineOwnsModel
    ? sourceMotionPlaybackModelAsset(sharedTimelinePlayback.contract)
    : null;
  const preferredModelAssetCandidate = sharedTimelineOwnsModel
    ? sharedTimelineAsset
    : runtimeVariantAssetForOption(variantOption)
      || sourceMotionModelAssetForBeatChange(previousIndex, activeIndex, progressionRoute)
      || modelAssetForBeat(beat);
  const preferredModelAsset = proceduralDynamicsAuthoredAssetVisible(
    preferredModelAssetCandidate?.id,
    proceduralPlans,
  ) ? preferredModelAssetCandidate : null;
  const spatialScene = runtimeSpatialSceneForBeat(beat, activeIndex, variantOption);
  const usesBeatSpatialScene = runtimeSceneUsesBeatSpatialAssets(spatialScene);
  const authoredSpatialAssetEntries = usesBeatSpatialScene
    ? runtimeSpatialAssetEntriesForBeat(beat, activeIndex, variantOption)
    : [];
  const spatialAssetEntries = authoredSpatialAssetEntries.filter((entry) => (
    proceduralDynamicsAuthoredAssetVisible(entry.asset?.id, proceduralPlans)
  ));
  const spatialModelEntries = spatialAssetEntries.filter((entry) => entry.kind === "model");
  const spatialTextAnchorAssetId = spatialTextEntityForBeat(beat, activeIndex, variantOption)?.anchor?.assetId || null;
  const primarySpatialModelEntry = (sharedTimelineOwnsModel
    ? spatialModelEntries.find((entry) => entry.asset.id === sharedTimelineAsset?.id)
    : null)
    || spatialModelEntries.find((entry) => entry.asset.id === spatialTextAnchorAssetId)
    || spatialModelEntries.find((entry) => entry.asset.id === preferredModelAsset?.id)
    || spatialModelEntries[0]
    || null;
  const modelAsset = usesBeatSpatialScene ? primarySpatialModelEntry?.asset || null : preferredModelAsset;
  const partState = modelAsset ? sourcePartStateForBeatAsset(beat.id, modelAsset.id) : null;
  const transitionPlayback = sharedTimelineOwnsModel && modelAsset?.id === sharedTimelineAsset?.id
    ? sharedTimelinePlayback
    : modelAsset && partState?.playbackMode !== "frozen"
      ? sourceTransitionForBeatChange(previousIndex, activeIndex, modelAsset.id, progressionRoute)
      : null;
  const text = variantOption?.text || beat.text || graphBeat?.text || "";
  const variantProgress = variantGroup && variantOption
    ? ` - option ${variantGroup.options.findIndex((option) => option.id === variantOption.id) + 1}/${variantGroup.options.length}`
    : "";
  const beatVisualKind = usesBeatSpatialScene && spatialAssetEntries.length
    ? "spatial scene"
    : modelAsset ? "model beat" : "text beat";
  beatProgress.textContent = `${activeIndex + 1} / ${beats.length} - ${beatVisualKind}${variantProgress}`;
  beatTitle.textContent = variantGroup?.title || beat.title || graphBeat?.title || "Untitled beat";
  beatText.textContent = text;
  renderRuntimeVariantControls(variantGroup, variantOption, variantInteraction);
  prevButton.disabled = activeIndex === 0;
  nextButton.disabled = activeIndex === beats.length - 1;
  for (const button of beatStrip.querySelectorAll("button")) {
    button.classList.toggle("active", Number(button.dataset.beatIndex) === activeIndex);
  }

  updateHabitat();
  if (usesBeatSpatialScene && spatialAssetEntries.length) {
    try {
      const result = await showSpatialSceneAssets(spatialAssetEntries, beat, previousIndex, {
        primaryModelEntry: primarySpatialModelEntry,
        primaryTransitionPlayback: transitionPlayback,
        loadRevision,
        spatialScene,
        route: progressionRoute,
      });
      if (loadRevision !== activeSceneLoadRevision) return;
      const assetSummary = `${result.loaded} linked scene asset${result.loaded === 1 ? "" : "s"}`;
      const failures = result.failed ? `; ${result.failed} failed to load` : "";
      status.textContent = `${assetSummary} loaded from compiled Spatial Relations${variantOption ? ` for ${variantOption.label}` : ""}${failures}${sourceAnimationStatusText()}.`;
    } catch (error) {
      if (loadRevision !== activeSceneLoadRevision) return;
      clearModel();
      status.textContent = `Could not load the compiled spatial scene: ${error.message}`;
    }
  } else if (usesBeatSpatialScene) {
    clearModel();
    status.textContent = "This compiled beat scene has no linked spatial assets.";
  } else if (modelAsset) {
    try {
      await showModel(modelAsset, beat, transitionPlayback, { loadRevision });
      if (loadRevision !== activeSceneLoadRevision) return;
      status.textContent = `${modelAsset.id} loaded from compiled runtime assets${variantOption ? ` for ${variantOption.label}` : ""}${sourceAnimationStatusText()}.`;
    } catch (error) {
      if (loadRevision !== activeSceneLoadRevision) return;
      clearModel();
      status.textContent = `Could not load ${modelAsset.path || modelAsset.id}: ${error.message}`;
    }
  } else {
    clearModel();
    status.textContent = "Text-only beat from compiled runtime.";
  }
  if (loadRevision !== activeSceneLoadRevision) return;
  try {
    const proceduralResult = await showProceduralDynamicsForBeat(
      beat,
      variantOption,
      loadRevision,
      proceduralPlans,
    );
    if (loadRevision !== activeSceneLoadRevision) return;
    if (proceduralResult.loaded) {
      status.textContent += ` ${proceduralResult.loaded} motion target${proceduralResult.loaded === 1 ? "" : "s"} active.`;
    }
    if (proceduralResult.failed) {
      status.textContent += ` ${proceduralResult.failed} motion target${proceduralResult.failed === 1 ? "" : "s"} could not bind.`;
    }
  } catch (error) {
    if (loadRevision !== activeSceneLoadRevision) return;
    clearProceduralDynamics();
    status.textContent += ` Generated motion unavailable: ${error.message}`;
  }
  activateRuntimeAttentionGuidance(activeAttentionGuidance);
  updateSpatialTextPanel(beat, text, modelAsset);
  applySpatialTraversalForBeat(beat, previousIndex, progressionRoute);
  configureRuntimeDirectManipulation();
  configureTraversalControls();
}

function normalizeRuntimeVariantGroups(value) {
  return (Array.isArray(value) ? value : []).flatMap((group, groupIndex) => {
    const id = String(group?.id || `variant-group-${groupIndex + 1}`).trim();
    const sourceOrderedOptions = (Array.isArray(group?.options) ? group.options : []).flatMap((option, optionIndex) => {
      const optionId = String(option?.id || `${id}-option-${optionIndex + 1}`).trim();
      const label = String(option?.label || option?.title || `Option ${optionIndex + 1}`).trim();
      if (!optionId || !label) return [];
      return [{
        ...option,
        id: optionId,
        label,
        text: String(option?.text || label).trim(),
        sourceOrder: Number.isFinite(Number(option?.sourceOrder)) ? Number(option.sourceOrder) : optionIndex,
        assetIds: uniqueStrings(option?.assetIds || option?.asset_ids || []),
      }];
    }).sort((left, right) => left.sourceOrder - right.sourceOrder);
    if (!id || sourceOrderedOptions.length < 2) return [];
    const requestedDefault = String(group?.defaultOptionId || "").trim();
    const defaultOptionId = sourceOrderedOptions.some((option) => option.id === requestedDefault)
      ? requestedDefault
      : sourceOrderedOptions[0].id;
    const defaultOption = sourceOrderedOptions.find((option) => option.id === defaultOptionId);
    const options = defaultOption
      ? [defaultOption, ...sourceOrderedOptions.filter((option) => option !== defaultOption)]
      : sourceOrderedOptions;
    return [{
      ...group,
      id,
      title: String(group?.title || "Selectable variants").trim(),
      beatId: String(group?.beatId || id).trim(),
      defaultOptionId,
      selectionMode: "single",
      control: {
        kind: String(group?.control?.kind || "previous-next").trim(),
        previousLabel: String(group?.control?.previousLabel || "Previous option").trim(),
        nextLabel: String(group?.control?.nextLabel || "Next option").trim(),
        wrap: group?.control?.wrap !== false,
      },
      options,
    }];
  });
}

function normalizeRuntimeVariantInteractionControl(value, variantGroups = []) {
  const declared = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];
  return (variantGroups || []).map((group) => {
    const record = declared.find((candidate) => (
      candidate?.variantGroupId === group.id
      || candidate?.beatId === group.beatId
    )) || {};
    return {
      ...record,
      beatId: String(record.beatId || group.beatId).trim(),
      variantGroupId: String(record.variantGroupId || group.id).trim(),
      inferredPolicy: "UI button press",
      effectivePolicy: "UI button press",
      surface: "text-panel",
      selectionMode: "single",
      sourceControlKind: String(record.sourceControlKind || group.control.kind).trim(),
      optionIds: group.options.map((option) => option.id),
      reason: String(record.reason || "Press Previous or Next on the text panel to update this beat without advancing the story.").trim(),
    };
  });
}

function normalizeRuntimeVariantInteractionPolicy(value) {
  const raw = typeof value === "string" ? value : runtimeInteractionPolicyValue(value, true);
  const label = String(raw || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!label || label === "ui button press" || label === "text panel selection") return "UI button press";
  if (label.includes("direct manipulation")) return "Direct manipulation";
  if (label.includes("reader locomotion") || label.includes("embodied progression")) return "Reader locomotion";
  return "UI button press";
}

function runtimeVariantInteractionSurface(policy) {
  if (policy === "Direct manipulation") return "scene-object";
  if (policy === "Reader locomotion") return "reader-route";
  return "text-panel";
}

function normalizeRuntimeVariantInteractionControlByEdge(
  value,
  graphEdges = [],
  variantGroups = [],
  legacyControls = [],
) {
  const groupsById = new Map((variantGroups || []).map((group) => [group.id, group]));
  const declared = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([edgeId, record]) => (
        typeof record === "string"
          ? { edgeId, effectivePolicy: record }
          : { edgeId, ...(record || {}) }
      ))
      : [];
  const declaredById = new Map(declared
    .filter((record) => record?.edgeId)
    .map((record) => [String(record.edgeId), record]));
  const edges = (Array.isArray(graphEdges) ? graphEdges : []).flatMap((edge) => {
    const from = edge?.from || {};
    const to = edge?.to || {};
    if (
      from.cardKind !== "variant"
      || to.cardKind !== "variant"
      || from.beatId !== to.beatId
      || from.variantGroupId !== to.variantGroupId
      || from.variantOptionId === to.variantOptionId
      || !groupsById.has(from.variantGroupId)
    ) return [];
    return [{
      edgeId: String(edge.id || `${from.variantGroupId}:${from.variantOptionId}->${to.variantOptionId}`),
      beatId: String(from.beatId || ""),
      variantGroupId: String(from.variantGroupId || ""),
      fromVariantOptionId: String(from.variantOptionId || ""),
      toVariantOptionId: String(to.variantOptionId || ""),
    }];
  });
  const sourceEdges = edges.length
    ? edges
    : declared.flatMap((record) => {
      const edgeId = String(record?.edgeId || "").trim();
      const variantGroupId = String(record?.variantGroupId || "").trim();
      const fromVariantOptionId = String(record?.fromVariantOptionId || record?.fromOptionId || "").trim();
      const toVariantOptionId = String(record?.toVariantOptionId || record?.toOptionId || "").trim();
      const group = groupsById.get(variantGroupId);
      if (!edgeId || !group || !fromVariantOptionId || !toVariantOptionId || fromVariantOptionId === toVariantOptionId) return [];
      return [{
        edgeId,
        beatId: String(record?.beatId || group.beatId || ""),
        variantGroupId,
        fromVariantOptionId,
        toVariantOptionId,
      }];
    });

  return sourceEdges.map((edge) => {
    const record = declaredById.get(edge.edgeId)
      || declared.find((candidate) => (
        candidate?.variantGroupId === edge.variantGroupId
        && (candidate?.fromVariantOptionId || candidate?.fromOptionId) === edge.fromVariantOptionId
        && (candidate?.toVariantOptionId || candidate?.toOptionId) === edge.toVariantOptionId
      ))
      || {};
    const legacy = (legacyControls || []).find((candidate) => (
      candidate?.variantGroupId === edge.variantGroupId || candidate?.beatId === edge.beatId
    ));
    const effectivePolicy = normalizeRuntimeVariantInteractionPolicy(
      record.effectivePolicy || record.policy || legacy?.effectivePolicy,
    );
    const configuration = normalizeRuntimeInteractionConfiguration(
      record.configuration || legacy?.configuration,
      effectivePolicy,
    );
    return {
      ...record,
      ...edge,
      defaultPolicy: "UI button press",
      inferredPolicy: "UI button press",
      effectivePolicy,
      overridden: Boolean(record.overridden || record.authored || effectivePolicy !== "UI button press"),
      authored: Boolean(record.authored || record.overridden || effectivePolicy !== "UI button press"),
      surface: runtimeVariantInteractionSurface(effectivePolicy),
      selectionMode: "directed-edge",
      locomotionMode: effectivePolicy === "Reader locomotion"
        ? normalizeRuntimeLocomotionMode(record.locomotionMode)
        : null,
      ...(configuration ? { configuration } : {}),
      reason: String(record.reason || "This directed variant arrow uses a text-panel UI button by default.").trim(),
    };
  });
}

function runtimeVariantInteractionForEdge(group, fromOptionId, toOptionId) {
  if (!group || !fromOptionId || !toOptionId) return null;
  return runtimeVariantInteractionControlByEdge.find((record) => (
    record.variantGroupId === group.id
    && record.fromVariantOptionId === fromOptionId
    && record.toVariantOptionId === toOptionId
  )) || null;
}

function runtimeVariantInteractionsFromOption(group, fromOptionId) {
  if (!group || !fromOptionId) return [];
  return runtimeVariantInteractionControlByEdge.filter((record) => (
    record.variantGroupId === group.id && record.fromVariantOptionId === fromOptionId
  ));
}

function runtimeVariantHasEdgeContract(group) {
  return Boolean(group && runtimeVariantInteractionControlByEdge.some((record) => record.variantGroupId === group.id));
}

function runtimeVariantUiButtonAllowed(group, fromOptionId, toOptionId) {
  if (!runtimeVariantHasEdgeContract(group)) return true;
  return runtimeVariantInteractionForEdge(group, fromOptionId, toOptionId)?.effectivePolicy === "UI button press";
}

function runtimeVariantGroupForBeat(beat) {
  if (!beat) return null;
  const direct = runtimeVariantGroupByBeatId.get(beat.id);
  if (direct) return direct;
  const groupId = String(beat.variantGroupId || graphBeats.get(beat.id)?.variantGroupId || "");
  return groupId ? runtimeVariantGroups.find((group) => group.id === groupId) || null : null;
}

function runtimeVariantInteractionForBeat(beat, group = runtimeVariantGroupForBeat(beat)) {
  if (!beat || !group) return null;
  return runtimeVariantInteractionByBeatId.get(beat.id)
    || runtimeVariantInteractionByGroupId.get(group.id)
    || null;
}

function runtimeVariantOptionForGroup(group) {
  if (!group) return null;
  const selectedId = activeVariantOptionByGroupId.get(group.id) || group.defaultOptionId;
  const option = group.options.find((candidate) => candidate.id === selectedId) || group.options[0] || null;
  if (option) activeVariantOptionByGroupId.set(group.id, option.id);
  return option;
}

function runtimeVariantAssetForOption(option) {
  if (!option) return null;
  const ids = new Set(uniqueStrings(option.assetIds || option.asset_ids || []));
  return (runtime.assets || []).find((asset) => ids.has(asset.id)) || null;
}

function renderRuntimeVariantControls(group, selectedOption, interactionControl) {
  if (!variantControls) return;
  if (!group || !selectedOption || interactionControl?.surface !== "text-panel") {
    variantControls.hidden = true;
    variantControls.innerHTML = "";
    return;
  }
  const selectedIndex = Math.max(0, group.options.findIndex((option) => option.id === selectedOption.id));
  const previousOption = runtimeVariantSteppedOption(group, selectedOption, -1);
  const nextOption = runtimeVariantSteppedOption(group, selectedOption, 1);
  const previousDisabled = !previousOption
    || !runtimeVariantUiButtonAllowed(group, selectedOption.id, previousOption.id);
  const nextDisabled = !nextOption
    || !runtimeVariantUiButtonAllowed(group, selectedOption.id, nextOption.id);
  const previousPresentation = runtimeTextPanelButtonPresentation(
    previousOption ? runtimeVariantInteractionForEdge(group, selectedOption.id, previousOption.id) : null,
    group.control.previousLabel,
    [0.2, 0.86],
  );
  const nextPresentation = runtimeTextPanelButtonPresentation(
    nextOption ? runtimeVariantInteractionForEdge(group, selectedOption.id, nextOption.id) : null,
    group.control.nextLabel,
    [0.8, 0.86],
  );
  const hasUiButton = !previousDisabled || !nextDisabled;
  variantControls.hidden = false;
  variantControls.innerHTML = `
    <p class="variant-interaction-label" data-variant-interaction="${hasUiButton ? "ui-button-press" : "assigned-edge-controls"}">${hasUiButton ? "UI button press" : "Variant interactions assigned"}</p>
    <div class="variant-control-head">
      <strong>${escapeHtml(selectedOption.label)}</strong>
      <span>${selectedIndex + 1} of ${group.options.length}</span>
    </div>
    <div class="variant-direction-controls">
      ${previousDisabled ? "" : `<button type="button" data-variant-direction="-1">${escapeHtml(previousPresentation.label)}</button>`}
      ${nextDisabled ? "" : `<button type="button" data-variant-direction="1">${escapeHtml(nextPresentation.label)}</button>`}
    </div>
    <div class="variant-option-list" role="tablist" aria-label="${escapeHtml(group.title)}">
      ${group.options.map((option) => `
        <button
          type="button"
          role="tab"
          aria-selected="${option.id === selectedOption.id ? "true" : "false"}"
          class="${option.id === selectedOption.id ? "active" : ""}"
          data-variant-option="${escapeHtml(option.id)}"
          ${option.id !== selectedOption.id && !runtimeVariantUiButtonAllowed(group, selectedOption.id, option.id) ? "disabled" : ""}
        >${escapeHtml(option.label)}</button>
      `).join("")}
    </div>
  `;
  for (const button of variantControls.querySelectorAll("[data-variant-option]")) {
    button.addEventListener("click", () => selectRuntimeVariantOption(group, button.dataset.variantOption));
  }
  for (const button of variantControls.querySelectorAll("[data-variant-direction]")) {
    button.addEventListener("click", () => stepRuntimeVariantOption(group, Number(button.dataset.variantDirection)));
  }
}

function selectRuntimeVariantOption(group, optionId) {
  if (!group?.options.some((option) => option.id === optionId)) return;
  const current = runtimeVariantOptionForGroup(group);
  if (current?.id !== optionId && !runtimeVariantUiButtonAllowed(group, current?.id, optionId)) return;
  activeVariantOptionByGroupId.set(group.id, optionId);
  setBeat(activeIndex);
}

function runtimeVariantSteppedOption(group, current, direction) {
  if (!group?.options.length || !current || !direction) return null;
  const currentIndex = Math.max(0, group.options.findIndex((option) => option.id === current.id));
  let nextIndex = currentIndex + Math.sign(direction);
  if (group.control.wrap !== false) nextIndex = (nextIndex + group.options.length) % group.options.length;
  else if (nextIndex < 0 || nextIndex >= group.options.length) return null;
  return group.options[nextIndex] || null;
}

function stepRuntimeVariantOption(group, direction) {
  if (!group?.options.length || !direction) return;
  const current = runtimeVariantOptionForGroup(group);
  const next = runtimeVariantSteppedOption(group, current, direction);
  if (!next) return;
  selectRuntimeVariantOption(group, next.id);
}

function sharedTimelineOwnsDestinationModel(playback) {
  return playback?.toPresence === "active";
}

function traversalStationIndexForBeat(beat) {
  if (!beat) return -1;
  const ids = beatIdentitySet(beat);
  return runtimeSpatialTraversal.orderedStations.findIndex((station) => ids.has(station.beatId));
}

function traversalStationForBeat(beat) {
  const index = traversalStationIndexForBeat(beat);
  return index >= 0 ? runtimeSpatialTraversal.orderedStations[index] : null;
}

function spatialReaderStationForBeat(beat, index = activeIndex) {
  const entity = spatialReaderEntityForBeat(beat, index);
  if (!entity) return null;
  const transform = effectiveSpatialEntityTransform(entity);
  return {
    stationId: `reader-station:${beat.id}`,
    beatId: beat.id,
    readerEntityId: String(entity.id || `reader:beat:${beat.id}`),
    coordinateSpace: "world",
    readerPosition: [...transform.position],
    readerQuaternion: [...transform.quaternion],
  };
}

function authoredReaderStationForBeat(beat, index = activeIndex) {
  return spatialReaderStationForBeat(beat, index) || traversalStationForBeat(beat);
}

function worldReaderPositionForStation(station) {
  if (!station) return null;
  const offset = new THREE.Vector3().fromArray(station.readerPosition);
  if (station.coordinateSpace === "reader-start") {
    const origin = new THREE.Vector3().fromArray(
      finiteInteractionArray(station.readerStartWorldPosition, 3, [0, 0, 0]),
    );
    const orientation = new THREE.Quaternion().fromArray(
      finiteInteractionArray(station.readerStartWorldQuaternion, 4, [0, 0, 0, 1]),
    ).normalize();
    return origin.add(offset.applyQuaternion(orientation));
  }
  if (station.coordinateSpace === "source-focus") {
    return (runtimeSourceCameraFocus(station.anchorAssetId)
      || runtimeActiveModelFocus(station.anchorAssetId)
      || runtimeSpatialAnchorFallback()).add(offset);
  }
  if (station.coordinateSpace === "asset") {
    return (runtimeActiveModelFocus(station.anchorAssetId) || runtimeSpatialAnchorFallback()).add(offset);
  }
  if (station.coordinateSpace === "reader") {
    const viewer = (renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera)
      .getWorldPosition(new THREE.Vector3());
    viewer.y = 0;
    return viewer.add(offset);
  }
  return offset;
}

function worldReaderQuaternionForStation(station) {
  const value = station?.readerQuaternion || station?.quaternion;
  if (!Array.isArray(value)) return null;
  const quaternion = new THREE.Quaternion(...normalizedSpatialQuaternion(value));
  if (station.coordinateSpace === "reader-start") {
    const readerStart = new THREE.Quaternion().fromArray(
      finiteInteractionArray(station.readerStartWorldQuaternion, 4, [0, 0, 0, 1]),
    ).normalize();
    return readerStart.multiply(quaternion).normalize();
  }
  return quaternion;
}

function applySpatialTraversalForBeat(beat, previousIndex = activeIndex, progressionRoute = null) {
  traversalDestinationRoot.clear();
  traversalDestinationRoot.position.set(0, 0, 0);
  physicalTraversalEnteredAt = null;
  activePhysicalTraversalZones.length = 0;
  physicalTraversalEnteredByZone.clear();
  const crossedBoundary = runtimeInteractionForBoundary(previousIndex, activeIndex, progressionRoute);
  const destinationStation = previousIndex < activeIndex
    ? runtimeLocomotionStationForBoundary(crossedBoundary, previousIndex, activeIndex)
    : traversalStationForBeat(beat);
  if (!runtimeReaderPoseInitialized) {
    const entryStation = authoredReaderStationForBeat(beat, activeIndex);
    const entryDestination = worldReaderPositionForStation(entryStation);
    if (entryStation?.readerEntityId && entryDestination) {
      teleportReaderTo(entryDestination, entryStation);
      runtimeReaderPoseInitialized = true;
    }
  }
  if (
    isReaderLocomotionInteraction(crossedBoundary)
    && runtimeBoundaryLocomotionMode(crossedBoundary) === "virtual-teleport"
    && destinationStation
    && destinationStation.coordinateSpace !== "reader"
  ) {
    const destination = worldReaderPositionForStation(destinationStation);
    if (destination) teleportReaderTo(destination, destinationStation);
  }

  const outgoingRoute = runtimeProgressionRouteForNavigation(activeIndex, activeIndex + 1);
  const outgoingBoundary = runtimeInteractionForBoundary(activeIndex, activeIndex + 1, outgoingRoute);
  if (isPhysicalLocomotionBoundary(outgoingBoundary)) {
    const station = runtimeLocomotionStationForBoundary(outgoingBoundary, activeIndex, activeIndex + 1);
    const destination = worldReaderPositionForStation(station);
    if (station && destination) {
      const tolerance = runtimeLocomotionTolerance(outgoingBoundary);
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(Math.max(0.12, tolerance.distanceMeters * 0.85), 0.025, 8, 64),
        new THREE.MeshBasicMaterial({ color: 0x6ed8c2, transparent: true, opacity: 0.76 }),
      );
      marker.rotation.x = -Math.PI / 2;
      traversalDestinationRoot.position.set(destination.x, 0, destination.z);
      traversalDestinationRoot.userData.readerStation = { ...station, worldPosition: destination.toArray() };
      traversalDestinationRoot.add(marker);
      activePhysicalTraversalZones.push({
        zoneId: String(outgoingBoundary.boundaryId || `${activeIndex}->${activeIndex + 1}`),
        kind: "beat",
        record: outgoingBoundary,
        station,
        markerRoot: traversalDestinationRoot,
        tolerance,
        destinationIndex: activeIndex + 1,
        route: outgoingRoute,
      });
    }
  }
  addRuntimeVariantLocomotionZones(beat);
}

function addRuntimeVariantLocomotionZones(beat) {
  const group = runtimeVariantGroupForBeat(beat);
  const selectedOption = runtimeVariantOptionForGroup(group);
  if (!group || !selectedOption) return;
  const records = runtimeVariantInteractionsFromOption(group, selectedOption.id)
    .filter((record) => isReaderLocomotionInteraction(record) && runtimeInteractionConfiguration(record)?.destination);
  for (const record of records) {
    const station = runtimeConfiguredLocomotionStation(record, activeIndex, activeIndex);
    const destination = worldReaderPositionForStation(station);
    if (!station || !destination) continue;
    const tolerance = runtimeLocomotionTolerance(record);
    const markerRoot = new THREE.Group();
    markerRoot.name = `storyvr-variant-locomotion-destination:${record.edgeId}`;
    markerRoot.position.set(
      destination.x - traversalDestinationRoot.position.x,
      0,
      destination.z - traversalDestinationRoot.position.z,
    );
    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(Math.max(0.12, tolerance.distanceMeters * 0.85), 0.022, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xe5aa63, transparent: true, opacity: 0.8 }),
    );
    marker.rotation.x = -Math.PI / 2;
    markerRoot.add(marker);
    traversalDestinationRoot.add(markerRoot);
    activePhysicalTraversalZones.push({
      zoneId: String(record.edgeId),
      kind: "variant",
      record,
      station,
      markerRoot,
      tolerance,
      variantGroup: group,
      toVariantOptionId: record.toVariantOptionId,
    });
  }
}

function teleportReaderTo(destination, station = null) {
  const desiredQuaternion = worldReaderQuaternionForStation(station);
  if (renderer.xr.isPresenting) {
    const viewerCamera = renderer.xr.getCamera(camera);
    viewerCamera.updateWorldMatrix(true, false);
    if (desiredQuaternion) {
      const currentQuaternion = viewerCamera.getWorldQuaternion(new THREE.Quaternion());
      const desiredYaw = xrEntryEuler.setFromQuaternion(desiredQuaternion, "YXZ").y;
      const currentYaw = xrEntryEuler.setFromQuaternion(currentQuaternion, "YXZ").y;
      const yawRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), desiredYaw - currentYaw);
      readerRig.quaternion.premultiply(yawRotation);
      readerRig.updateMatrixWorld(true);
    }
    viewerCamera.updateWorldMatrix(true, false);
    const viewerPosition = viewerCamera.getWorldPosition(new THREE.Vector3());
    readerRig.position.add(destination.clone().sub(viewerPosition));
    readerRig.updateMatrixWorld(true);
    return;
  }
  const current = camera.getWorldPosition(new THREE.Vector3());
  const delta = destination.clone().sub(current);
  readerRig.updateWorldMatrix(true, false);
  camera.position.copy(readerRig.worldToLocal(destination.clone()));
  if (desiredQuaternion) {
    const targetDistance = Math.max(1, current.distanceTo(controls.target));
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(desiredQuaternion).normalize();
    controls.target.copy(destination).addScaledVector(forward, targetDistance);
  } else controls.target.add(delta);
  controls.update();
  resetDesktopReaderLookAnchor();
}

function updatePhysicalTraversal() {
  const outgoingBoundary = runtimeInteractionForBoundary(activeIndex, activeIndex + 1);
  if (!isPhysicalLocomotionBoundary(outgoingBoundary) && !activePhysicalTraversalZones.length) return;
  const viewer = (renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera).getWorldPosition(new THREE.Vector3());
  for (const zone of activePhysicalTraversalZones) {
    const destination = worldReaderPositionForStation(zone.station);
    if (!destination) continue;
    if (zone.markerRoot === traversalDestinationRoot) {
      traversalDestinationRoot.position.set(destination.x, 0, destination.z);
      traversalDestinationRoot.userData.readerStation = { ...zone.station, worldPosition: destination.toArray() };
    } else {
      zone.markerRoot.position.set(
        destination.x - traversalDestinationRoot.position.x,
        0,
        destination.z - traversalDestinationRoot.position.z,
      );
    }
    const entered = Math.hypot(viewer.x - destination.x, viewer.z - destination.z) <= zone.tolerance.distanceMeters;
    if (!entered) {
      physicalTraversalEnteredByZone.delete(zone.zoneId);
      if (zone.kind === "beat") physicalTraversalEnteredAt = null;
      continue;
    }
    const enteredAt = physicalTraversalEnteredByZone.get(zone.zoneId) ?? elapsedSeconds;
    physicalTraversalEnteredByZone.set(zone.zoneId, enteredAt);
    if (zone.kind === "beat") physicalTraversalEnteredAt = enteredAt;
    if (physicalTraversalAdvancing || elapsedSeconds - enteredAt < zone.tolerance.dwellSeconds) continue;
    physicalTraversalAdvancing = true;
    if (zone.kind === "variant") {
      activeVariantOptionByGroupId.set(zone.variantGroup.id, zone.toVariantOptionId);
      Promise.resolve(setBeat(activeIndex)).finally(() => {
        physicalTraversalAdvancing = false;
      });
      return;
    }
    const nextIndex = zone.destinationIndex;
    if (nextIndex < 0 || nextIndex >= beats.length) {
      physicalTraversalAdvancing = false;
      continue;
    }
    Promise.resolve(setBeat(nextIndex, { route: zone.route })).finally(() => {
      physicalTraversalAdvancing = false;
    });
    return;
  }
}

function proceduralDynamicsRuntimePlansForBeat(beat, variantOption = null) {
  return proceduralDynamicsPlansForScene(runtimeProceduralDynamics, {
    beatId: beat?.id,
    variantOptionId: variantOption?.id,
  });
}

function proceduralDynamicsAuthoredAssetVisible() {
  // Procedural Dynamics is a motion-only layer. Even legacy plans cannot hide
  // an authored model or replace it with a generated clone.
  return true;
}

function proceduralDynamicsClipForInstance(instance, clips) {
  const available = Array.isArray(clips) ? clips : [];
  const clipSpec = instance?.clip || {};
  const indexes = [
    instance?.clipIndex,
    clipSpec.index,
    clipSpec.clipIndex,
    ...(clipSpec.indexes || clipSpec.clipIndexes || []),
  ].map(Number).filter((index) => Number.isInteger(index) && index >= 0);
  for (const index of indexes) {
    if (available[index]) return available[index];
  }
  const requestedName = String(
    instance?.clipName
      || clipSpec.name
      || clipSpec.clipName
      || clipSpec.animationName
      || "",
  ).trim();
  if (requestedName) {
    const named = available.find((clip) => clip.name === requestedName);
    if (named) return named;
  }
  return available[0] || null;
}

async function showProceduralDynamicsForBeat(beat, variantOption, loadRevision, suppliedPlans = null) {
  clearProceduralDynamics();
  const rawPlans = Array.isArray(suppliedPlans)
    ? suppliedPlans
    : proceduralDynamicsRuntimePlansForBeat(beat, variantOption);
  if (!rawPlans.length) return { loaded: 0, failed: 0 };

  readerRig.updateWorldMatrix(true, false);
  const authoredStation = authoredReaderStationForBeat(beat, activeIndex);
  const authoredAnchorPosition = worldReaderPositionForStation(authoredStation);
  const readerCamera = renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera;
  readerCamera.updateWorldMatrix(true, false);
  const anchorPosition = readerCamera.getWorldPosition(new THREE.Vector3());
  if (![anchorPosition.x, anchorPosition.y, anchorPosition.z].every(Number.isFinite) && authoredAnchorPosition) {
    anchorPosition.copy(authoredAnchorPosition);
  }
  const plannedInstances = rawPlans.flatMap((rawPlan) => {
    // A desktop reader can enter XR without reloading the active beat, so the
    // compiled reader continues to use the XR-safe plan normalization.
    const plan = clampProceduralDynamicsPlan(rawPlan, { xrPresenting: true });
    const actorById = new Map((plan.actors || []).map((actor) => [actor.actorId, actor]));
    return expandProceduralDynamicsInstances(plan, { xrPresenting: true }).map((instance) => ({
      ...instance,
      entityId: instance.entityId || actorById.get(instance.actorId)?.entityId || null,
    }));
  });
  if (loadRevision !== activeSceneLoadRevision) return { loaded: 0, failed: 0 };

  const targets = activeProceduralDynamicsModelTargets();
  const assignedTargetRoots = new Set();
  let loadedCount = 0;
  let failedCount = 0;
  for (const instance of plannedInstances) {
    const target = proceduralDynamicsTargetForInstance(targets, instance, assignedTargetRoots);
    if (!target) {
      failedCount += 1;
      continue;
    }
    const entry = bindProceduralDynamicsToAuthoredTarget(target, instance, anchorPosition);
    if (!entry) {
      failedCount += 1;
      continue;
    }
    assignedTargetRoots.add(target.authorTransformRoot);
    activeProceduralDynamicsEntries.push(entry);
    loadedCount += 1;
  }
  updateProceduralDynamics(0);
  return { loaded: loadedCount, failed: failedCount };
}

function proceduralDynamicsTargetEntityId(target) {
  return String(
    target?.entity?.id
      || target?.entity?.entityId
      || target?.authorTransformRoot?.userData?.spatialEntityId
      || "",
  ).trim();
}

function activeProceduralDynamicsModelTargets() {
  return [
    ...(activeModel && activeModelAsset ? [{
      asset: activeModelAsset,
      entity: activeModelSpatialEntity,
      model: activeModel,
      authorTransformRoot: modelAuthorTransformRoot,
      animations: activeModelAnimations,
      playback: activeSourceAnimation,
    }] : []),
    ...activeSupplementalModelEntries.map((entry) => ({
      asset: entry.asset,
      entity: entry.entity,
      model: entry.model,
      authorTransformRoot: entry.authorTransformRoot,
      animations: entry.animations || [],
      playback: entry.playback,
    })),
  ].filter((target) => target.model && target.authorTransformRoot?.parent);
}

function proceduralDynamicsTargetForInstance(targets, instance, assignedTargetRoots) {
  const entityId = String(instance?.entityId || instance?.targetEntityId || "").trim();
  const assetId = String(instance?.assetId || "").trim();
  const available = targets.filter((target) => (
    !assignedTargetRoots.has(target.authorTransformRoot)
    && (!assetId || String(target.asset?.id || "") === assetId)
  ));
  if (entityId) {
    return available.find((target) => proceduralDynamicsTargetEntityId(target) === entityId) || null;
  }
  // Legacy plans did not carry entity IDs. They remain safe only when the
  // linked asset resolves to exactly one already-loaded authored instance.
  return available.length === 1 ? available[0] : null;
}

function insertObjectAtChildIndex(parent, child, requestedIndex) {
  if (!parent || !child) return;
  parent.add(child);
  const currentIndex = parent.children.indexOf(child);
  const targetIndex = Math.max(0, Math.min(Number(requestedIndex) || 0, parent.children.length - 1));
  if (currentIndex === targetIndex) return;
  parent.children.splice(currentIndex, 1);
  parent.children.splice(targetIndex, 0, child);
}

function suspendProceduralDynamicsSourcePlayback(playback) {
  return (playback?.actions || []).map((action) => {
    const state = {
      action,
      enabled: action.enabled,
      paused: action.paused,
    };
    action.enabled = false;
    return state;
  });
}

function restoreProceduralDynamicsSourcePlayback(states) {
  for (const state of states || []) {
    state.action.enabled = state.enabled;
    state.action.paused = state.paused;
  }
}

function bindProceduralDynamicsToAuthoredTarget(target, instance, anchorPosition) {
  const authorTransformRoot = target?.authorTransformRoot;
  const originalParent = authorTransformRoot?.parent || null;
  if (!authorTransformRoot || !originalParent || !target?.model) return null;
  const originalChildIndex = originalParent.children.indexOf(authorTransformRoot);
  const motionRoot = new THREE.Group();
  motionRoot.name = `storyvr-procedural-motion:${instance.planId}:${instance.actorId}`;
  motionRoot.userData.storyvrProceduralDynamics = true;
  motionRoot.userData.spatialEntityId = proceduralDynamicsTargetEntityId(target);
  motionRoot.userData.assetId = target.asset?.id || instance.assetId || null;
  insertObjectAtChildIndex(originalParent, motionRoot, originalChildIndex);
  motionRoot.add(authorTransformRoot);

  const clip = proceduralDynamicsClipForInstance(instance, target.animations);
  const sourcePlaybackActionStates = clip && instance.animationMode !== "none"
    ? suspendProceduralDynamicsSourcePlayback(target.playback)
    : [];
  let mixer = null;
  let action = null;
  if (clip && instance.animationMode !== "none") {
    mixer = new THREE.AnimationMixer(target.model);
    action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.timeScale = instance.animationTimeScale;
    action.play();
    action.time = (Number(clip.duration) || 0) * instance.animationPhase01;
    mixer.update(0);
  }
  return {
    instance,
    model: target.model,
    wrapper: motionRoot,
    authorTransformRoot,
    originalParent,
    originalChildIndex,
    anchorPosition: anchorPosition.clone().add(
      new THREE.Vector3().fromArray(instance.anchor?.offsetMeters || [0, 0, 0]),
    ),
    startedAtSeconds: elapsedSeconds,
    mixer,
    action,
    sourcePlayback: target.playback || null,
    sourcePlaybackActionStates,
    targetQuaternion: new THREE.Quaternion(),
    localTargetQuaternion: new THREE.Quaternion(),
    parentWorldQuaternion: new THREE.Quaternion(),
    motionWorldPosition: new THREE.Vector3(),
    motionLocalPosition: new THREE.Vector3(),
    authoredModelBinding: true,
  };
}

function updateProceduralDynamics(delta) {
  for (const entry of activeProceduralDynamicsEntries) {
    const localTime = Math.max(0, elapsedSeconds - entry.startedAtSeconds);
    const sample = sampleProceduralDynamicsTransform(entry.instance, localTime);
    entry.motionWorldPosition.fromArray(sample.position).add(entry.anchorPosition);
    entry.originalParent.updateWorldMatrix(true, false);
    entry.motionLocalPosition.copy(entry.motionWorldPosition);
    entry.originalParent.worldToLocal(entry.motionLocalPosition);
    entry.wrapper.position.copy(entry.motionLocalPosition);
    if (entry.instance.orientationKind === "path-tangent") {
      const [x, , z] = sample.tangent;
      let yaw = Math.atan2(x, z) + Number(entry.instance.yawOffsetRadians || 0);
      if (entry.instance.modelForwardAxis === "-Z") yaw += Math.PI;
      else if (entry.instance.modelForwardAxis === "+X") yaw -= Math.PI / 2;
      else if (entry.instance.modelForwardAxis === "-X") yaw += Math.PI / 2;
      entry.targetQuaternion.setFromAxisAngle(proceduralDynamicsUpAxis, yaw);
      entry.originalParent.getWorldQuaternion(entry.parentWorldQuaternion);
      entry.localTargetQuaternion
        .copy(entry.parentWorldQuaternion)
        .invert()
        .multiply(entry.targetQuaternion);
      const smoothing = Math.max(0, Number(entry.instance.orientationSmoothingSeconds) || 0);
      const blend = smoothing > 0 && delta > 0 ? 1 - Math.exp(-delta / smoothing) : 1;
      entry.wrapper.quaternion.slerp(entry.localTargetQuaternion, blend);
    }
    entry.mixer?.update(delta);
  }
}

function clearProceduralDynamics() {
  for (const entry of activeProceduralDynamicsEntries.splice(0)) disposeProceduralDynamicsEntry(entry);
}

function disposeProceduralDynamicsEntry(entry) {
  if (entry.mixer) {
    entry.mixer.stopAllAction();
    entry.mixer.uncacheRoot(entry.model);
  }
  restoreProceduralDynamicsSourcePlayback(entry.sourcePlaybackActionStates);
  entry.sourcePlayback?.mixer?.update?.(0);
  const authorTransformRoot = entry.authorTransformRoot;
  if (authorTransformRoot?.parent === entry.wrapper) entry.wrapper.remove(authorTransformRoot);
  if (entry.originalParent && authorTransformRoot) {
    insertObjectAtChildIndex(entry.originalParent, authorTransformRoot, entry.originalChildIndex);
  }
  entry.wrapper.removeFromParent();
}

function supplementalSpatialTransitionPlayback(entry, primaryModelEntry, primaryTransitionPlayback) {
  const assetId = String(entry?.asset?.id || "");
  return assetId && assetId === String(primaryModelEntry?.asset?.id || "")
    ? primaryTransitionPlayback || null
    : null;
}

async function showSpatialSceneAssets(entries, beat, previousIndex, options = {}) {
  clearModel();
  modelRoot.position.set(0, 0, 0);
  const primaryModelEntry = options.primaryModelEntry || null;
  const tasks = entries.map((entry) => {
    if (entry.kind === "image") {
      return showSpatialImage(entry, {
        loadRevision: options.loadRevision,
      });
    }
    if (entry === primaryModelEntry) {
      return showModel(entry.asset, beat, options.primaryTransitionPlayback, {
        clear: false,
        directSpatialPlacement: true,
        spatialEntity: entry.entity,
        loadRevision: options.loadRevision,
      });
    }
      return showSupplementalModel(entry, beat, previousIndex, {
        loadRevision: options.loadRevision,
        route: options.route,
        transitionPlayback: supplementalSpatialTransitionPlayback(
          entry,
          primaryModelEntry,
          options.primaryTransitionPlayback,
        ),
      });
  });
  const results = await Promise.allSettled(tasks);
  return results.reduce((summary, result) => {
    if (result.status === "fulfilled" && result.value !== false) summary.loaded += 1;
    else if (!(result.status === "fulfilled" && result.value === false && options.loadRevision !== activeSceneLoadRevision)) summary.failed += 1;
    return summary;
  }, { loaded: 0, failed: 0 });
}

async function showModel(asset, beat, transitionPlayback = null, options = {}) {
  if (options.clear !== false) clearModel();
  const source = `${captureRoot}/${asset.path}`;
  const model = await loadModel(source);
  if (options.loadRevision && options.loadRevision !== activeSceneLoadRevision) return false;
  activeModel = model.scene.clone(true);
  activeModelAsset = asset;
  activeModelSpatialEntity = options.spatialEntity || null;
  activeModelAnimations = Array.isArray(model.animations) ? model.animations : [];
  activeModel.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  if (options.directSpatialPlacement) modelRoot.position.set(0, 0, 0);
  else modelRoot.position.copy(modelRootPositionForBeat(beat, asset));
  if (options.spatialEntity) applyRuntimeGlbSpatialTransform(asset, beat, options.spatialEntity);
  else applyRuntimeGlbSpatialTransform(asset, beat);
  const sharedTimelineContract = sharedTimelineContractForAsset(asset.id);
  const contractedTimeline = Boolean(sharedTimelineContract);
  frameModel(activeModel, {
    groundAligned: runtimeSpatialEntityGroundAligned(
      options.spatialEntity,
      sharedTimelineContract,
      runtimeSpatialRelations,
    ),
  });
  modelAuthorTransformRoot.add(activeModel);
  const sourcePartState = sourcePartStateForBeatAsset(beat.id, asset.id);
  const destinationPartSelectors = sourcePartSelectorsForBeatAsset(beat.id, asset.id);
  const sharedTimeline = Boolean(transitionPlayback?.sharedTimeline);
  const transitionPartSelectors = transitionPlayback && sourcePartState?.playbackMode !== "frozen" && !contractedTimeline
    ? uniqueStrings([
      ...sourcePartSelectorsForBeatAsset(transitionPlayback.fromBeatId, asset.id),
      ...destinationPartSelectors,
    ])
    : destinationPartSelectors;
  if (!contractedTimeline) applySourcePartMask(activeModel, transitionPartSelectors);
  if (sharedTimeline) {
    activeSourceAnimation = createSharedTimelinePlayback(
      activeModel,
      model.animations,
      clonedSourceCameras(activeModel, model.cameras),
      transitionPlayback,
    );
  } else if (contractedTimeline) {
    activeSourceAnimation = createSourceAnimationPlayback(
      activeModel,
      model.animations,
      clonedSourceCameras(activeModel, model.cameras),
      asset,
      beat,
      transitionPlayback,
    );
  } else if (sourcePartState?.playbackMode === "frozen") {
    activeSourceAnimation = createFrozenSourcePartPlayback(activeModel, model.animations, sourcePartState);
  } else {
    activeSourceAnimation = createSourceAnimationPlayback(
      activeModel,
      model.animations,
      clonedSourceCameras(activeModel, model.cameras),
      asset,
      beat,
      transitionPlayback,
    );
  }
  if (activeSourceAnimation) activeSourceAnimation.destinationPartSelectors = destinationPartSelectors;
  else if (!contractedTimeline) applySourcePartMask(activeModel, destinationPartSelectors);
  return true;
}

async function showSupplementalModel(entry, beat, previousIndex, options = {}) {
  const source = `${captureRoot}/${entry.asset.path}`;
  const loaded = await loadModel(source);
  if (options.loadRevision && options.loadRevision !== activeSceneLoadRevision) return false;
  const model = loaded.scene.clone(true);
  model.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  const sharedTimelineContract = sharedTimelineContractForAsset(entry.asset.id);
  const contractedTimeline = Boolean(sharedTimelineContract);
  frameModel(model, {
    groundAligned: runtimeSpatialEntityGroundAligned(
      entry.entity,
      sharedTimelineContract,
      runtimeSpatialRelations,
    ),
  });
  const authorTransformRoot = new THREE.Group();
  authorTransformRoot.name = `storyvr-spatial-relations-author-transform:${entry.asset.id}`;
  applyRuntimeSpatialEntityTransform(authorTransformRoot, entry.entity, `glb:${entry.asset.id}`);
  authorTransformRoot.add(model);
  modelRoot.add(authorTransformRoot);

  const sourcePartState = sourcePartStateForBeatAsset(beat.id, entry.asset.id);
  const destinationPartSelectors = sourcePartSelectorsForBeatAsset(beat.id, entry.asset.id);
  const transitionPlayback = options.transitionPlayback
    || (sourcePartState?.playbackMode !== "frozen"
      ? sourceTransitionForBeatChange(previousIndex, activeIndex, entry.asset.id, options.route)
      : null);
  const transitionPartSelectors = transitionPlayback && !contractedTimeline
    ? uniqueStrings([
      ...sourcePartSelectorsForBeatAsset(transitionPlayback.fromBeatId, entry.asset.id),
      ...destinationPartSelectors,
    ])
    : destinationPartSelectors;
  if (!contractedTimeline) applySourcePartMask(model, transitionPartSelectors);
  let playback = null;
  if (
    contractedTimeline
    && transitionPlayback?.sharedTimeline === true
    && transitionPlayback?.contract?.assetId === entry.asset.id
  ) {
    playback = createSharedTimelinePlayback(
      model,
      loaded.animations,
      clonedSourceCameras(model, loaded.cameras),
      transitionPlayback,
    );
  } else if (contractedTimeline) {
    playback = createSourceAnimationPlayback(
      model,
      loaded.animations,
      clonedSourceCameras(model, loaded.cameras),
      entry.asset,
      beat,
      transitionPlayback,
    );
  } else if (sourcePartState?.playbackMode === "frozen") {
    playback = createFrozenSourcePartPlayback(model, loaded.animations, sourcePartState);
  } else {
    playback = createSourceAnimationPlayback(
      model,
      loaded.animations,
      clonedSourceCameras(model, loaded.cameras),
      entry.asset,
      beat,
      transitionPlayback,
    );
  }
  if (playback) playback.destinationPartSelectors = destinationPartSelectors;
  else if (!contractedTimeline) applySourcePartMask(model, destinationPartSelectors);
  activeSupplementalModelEntries.push({
    asset: entry.asset,
    entity: entry.entity,
    model,
    authorTransformRoot,
    animations: Array.isArray(loaded.animations) ? loaded.animations : [],
    playback,
  });
  return true;
}

function loadImageTexture(source) {
  if (imageTextureCache.has(source)) return imageTextureCache.get(source);
  const promise = new THREE.TextureLoader().loadAsync(source).then((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  });
  imageTextureCache.set(source, promise);
  return promise;
}

async function showSpatialImage(entry, options = {}) {
  const source = `${captureRoot}/${entry.asset.path}`;
  const texture = await loadImageTexture(source);
  if (options.loadRevision && options.loadRevision !== activeSceneLoadRevision) return false;
  const image = entry.entity?.image && typeof entry.entity.image === "object" ? entry.entity.image : {};
  const naturalWidth = Number(texture.image?.naturalWidth || texture.image?.videoWidth || texture.image?.width) || 1;
  const naturalHeight = Number(texture.image?.naturalHeight || texture.image?.videoHeight || texture.image?.height) || 1;
  const aspectRatio = Math.max(0.05, Number(image.aspectRatio) || naturalWidth / naturalHeight || 1);
  const width = Math.max(0.05, Number(image.width) || (Number(image.height) ? Number(image.height) * aspectRatio : 1.6));
  const height = Math.max(0.05, Number(image.height) || width / aspectRatio);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, toneMapped: false }),
  );
  plane.name = `storyvr-spatial-image:${entry.asset.id}`;
  const authorTransformRoot = new THREE.Group();
  authorTransformRoot.name = `storyvr-spatial-relations-author-transform:${entry.asset.id}`;
  applyRuntimeSpatialEntityTransform(authorTransformRoot, entry.entity, `image:${entry.asset.id}`);
  authorTransformRoot.add(plane);
  modelRoot.add(authorTransformRoot);
  activeSpatialImageEntries.push({ asset: entry.asset, plane, authorTransformRoot });
  return true;
}

function clearModel() {
  clearRuntimeDirectManipulation();
  clearRuntimeAttentionCues();
  clearProceduralDynamics();
  if (activeSourceAnimation) {
    for (const element of activeSourceAnimation.annotationElements || []) element.remove?.();
    activeSourceAnimation.mixer.stopAllAction();
    if (activeModel) activeSourceAnimation.mixer.uncacheRoot(activeModel);
    activeSourceAnimation = null;
  }
  if (activeModel) modelAuthorTransformRoot.remove(activeModel);
  for (const entry of activeSupplementalModelEntries.splice(0)) {
    if (entry.playback) {
      for (const element of entry.playback.annotationElements || []) element.remove?.();
      entry.playback.mixer.stopAllAction();
      entry.playback.mixer.uncacheRoot(entry.model);
    }
    entry.authorTransformRoot.removeFromParent();
  }
  for (const entry of activeSpatialImageEntries.splice(0)) {
    entry.authorTransformRoot.removeFromParent();
    entry.plane.geometry?.dispose?.();
    entry.plane.material?.dispose?.();
  }
  activeModel = null;
  activeModelAsset = null;
  activeModelSpatialEntity = null;
  activeModelAnimations = [];
  spatialTextFocusCache.clear();
  spatialTextModelFocusCache.clear();
  spatialTextCollisionProxyCache = { root: null, checkedAt: -Infinity, entries: [] };
  modelAuthorTransformRoot.position.set(0, 0, 0);
  modelAuthorTransformRoot.quaternion.identity();
  modelAuthorTransformRoot.scale.set(1, 1, 1);
}

function applyRuntimeGlbSpatialTransform(asset, beat, declaredEntity = null) {
  const entity = declaredEntity || runtimeGlbSpatialEntity(asset, beat);
  applyRuntimeSpatialEntityTransform(modelAuthorTransformRoot, entity, asset?.id ? `glb:${asset.id}` : null);
}

function applyRuntimeSpatialEntityTransform(target, entity, fallbackEntityId = null) {
  if (!target) return;
  const transform = effectiveSpatialEntityTransform(entity);
  target.position.fromArray(transform.position);
  target.quaternion.fromArray(transform.quaternion).normalize();
  target.scale.fromArray(transform.scale);
  target.userData.spatialEntityId = entity?.id || entity?.entityId || fallbackEntityId;
  target.userData.assetId = spatialAssetIdFromEntity(entity) || null;
}

function updateSpatialTextPanel(beat, text, modelAsset) {
  if (!beat) return;
  spatialTextPlacement = runtimeTextPlacementForBeat(beat);
  if (!spatialTextPanel) spatialTextPanel = createRuntimeHandTextPanel();
  const variantState = runtimeTextPanelVariantState(beat);
  const title = variantState?.group?.title || beat.title || "Story beat";
  const contentKey = JSON.stringify([
    beat.id,
    variantState?.selectedOption?.id || "",
    title,
    text || "",
  ]);
  const previousContent = spatialTextPanel.userData.textContent;
  renderRuntimeTextPanelContent(spatialTextPanel, {
    key: contentKey,
    title,
    text: text || "",
    placement: spatialTextPlacement,
    variantState,
    scrollLine: previousContent?.key === contentKey ? previousContent.scrollLine : 0,
  });
  syncRuntimeTextPanelVariantControls(variantState);
  spatialTextPanel.userData.beatId = beat.id;
  spatialTextPanel.userData.assetId = modelAsset?.id || null;
  setTextPanelMinimized(textPanelMinimized);
  attachSpatialTextPanelToPreferredHand();
  updateSpatialTextPanelPose();
}

function renderRuntimeTextPanelContent(panel, content) {
  const contentMaterial = panel?.userData?.contentMesh?.material;
  if (!contentMaterial || !content) return false;
  const texture = makeRuntimeTextPanelTexture(
    content.title,
    content.text,
    content.placement,
    content.variantState,
    content.scrollLine,
  );
  contentMaterial.map?.dispose?.();
  contentMaterial.map = texture;
  contentMaterial.needsUpdate = true;
  const pagination = texture.userData.storyvrTextPanelPagination;
  panel.userData.textPagination = pagination;
  panel.userData.textContent = {
    ...content,
    scrollLine: pagination.scrollLine,
  };
  return true;
}

function setRuntimeTextPanelScrollLine(value) {
  const panel = spatialTextPanel;
  const content = panel?.userData?.textContent;
  const pagination = panel?.userData?.textPagination;
  if (!content || !pagination) return false;
  const scrollLine = Math.max(0, Math.min(pagination.maxScrollLine, Math.round(Number(value) || 0)));
  if (scrollLine === content.scrollLine) return false;
  return renderRuntimeTextPanelContent(panel, { ...content, scrollLine });
}

function createRuntimeHandTextPanel() {
  const group = new THREE.Group();
  group.name = "storyvr-hand-text-panel";
  group.userData.storyvrTextPanel = true;

  const expandedRoot = new THREE.Group();
  expandedRoot.name = "storyvr-hand-text-panel-expanded";
  const contentMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(XR_TEXT_PANEL_WIDTH, XR_TEXT_PANEL_HEIGHT),
    new THREE.MeshBasicMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  contentMesh.renderOrder = XR_TEXT_PANEL_RENDER_ORDER;
  contentMesh.userData.storyvrTextPanelAction = "scroll";
  expandedRoot.add(contentMesh);

  const minimizeButton = makeRuntimeTextPanelControl("\u2212", "minimize", 0.052);
  minimizeButton.position.set((XR_TEXT_PANEL_WIDTH / 2) - 0.034, (XR_TEXT_PANEL_HEIGHT / 2) - 0.034, 0.004);
  expandedRoot.add(minimizeButton);

  const variantControlRoot = new THREE.Group();
  variantControlRoot.name = "storyvr-hand-text-panel-variant-controls";
  const variantPreviousButton = makeRuntimeTextPanelButton("Previous", "variant-previous");
  variantPreviousButton.position.set(-0.085, -0.098, 0.006);
  const variantNextButton = makeRuntimeTextPanelButton("Next", "variant-next");
  variantNextButton.position.set(0.085, -0.098, 0.006);
  variantControlRoot.add(variantPreviousButton, variantNextButton);
  variantControlRoot.visible = false;
  expandedRoot.add(variantControlRoot);

  const minimizedRoot = new THREE.Group();
  minimizedRoot.name = "storyvr-hand-text-panel-minimized";
  const restoreButton = makeRuntimeTextPanelControl("Aa", "restore", 0.105);
  minimizedRoot.add(restoreButton);
  minimizedRoot.visible = false;

  group.add(expandedRoot, minimizedRoot);
  group.userData.expandedRoot = expandedRoot;
  group.userData.minimizedRoot = minimizedRoot;
  group.userData.contentMesh = contentMesh;
  group.userData.minimizeButton = minimizeButton;
  group.userData.variantControlRoot = variantControlRoot;
  group.userData.variantPreviousButton = variantPreviousButton;
  group.userData.variantNextButton = variantNextButton;
  group.userData.restoreButton = restoreButton;
  group.visible = false;
  return group;
}

function makeRuntimeTextPanelControl(label, action, size) {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(8, 22, 19, 0.98)";
  context.beginPath();
  context.arc(96, 96, 82, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 10;
  context.strokeStyle = "rgba(110, 216, 194, 0.96)";
  context.stroke();
  context.fillStyle = "#f6f2e7";
  context.font = label === "Aa" ? "800 66px sans-serif" : "800 108px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 96, label === "Aa" ? 100 : 88);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.renderOrder = XR_TEXT_PANEL_RENDER_ORDER + 2;
  mesh.userData.storyvrTextPanelAction = action;
  return mesh;
}

function makeRuntimeTextPanelButton(label, action) {
  const texture = makeRuntimeTextPanelButtonTexture(label);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.155, 0.048),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.renderOrder = XR_TEXT_PANEL_RENDER_ORDER + 2;
  mesh.userData.storyvrTextPanelAction = action;
  mesh.userData.storyvrTextPanelDisabled = false;
  mesh.userData.storyvrTextPanelLabel = label;
  return mesh;
}

function makeRuntimeTextPanelButtonTexture(label) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(8, 22, 19, 0.98)";
  context.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
  context.lineWidth = 10;
  context.strokeStyle = "rgba(110, 216, 194, 0.96)";
  context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  context.fillStyle = "#f6f2e7";
  const buttonLabel = String(label || "Select").slice(0, 80);
  let fontSize = 58;
  context.font = `800 ${fontSize}px sans-serif`;
  while (fontSize > 24 && context.measureText(buttonLabel).width > canvas.width - 56) {
    fontSize -= 2;
    context.font = `800 ${fontSize}px sans-serif`;
  }
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(buttonLabel, canvas.width / 2, (canvas.height / 2) + 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function runtimeTextPanelVariantState(beat) {
  const group = runtimeVariantGroupForBeat(beat);
  const interactionControl = runtimeVariantInteractionForBeat(beat, group);
  const selectedOption = runtimeVariantOptionForGroup(group);
  if (
    !group
    || !selectedOption
    || interactionControl?.surface !== "text-panel"
    || interactionControl?.effectivePolicy !== "UI button press"
  ) return null;
  const selectedIndex = Math.max(0, group.options.findIndex((option) => option.id === selectedOption.id));
  const previousOption = runtimeVariantSteppedOption(group, selectedOption, -1);
  const nextOption = runtimeVariantSteppedOption(group, selectedOption, 1);
  const previousInteraction = previousOption
    ? runtimeVariantInteractionForEdge(group, selectedOption.id, previousOption.id)
    : null;
  const nextInteraction = nextOption
    ? runtimeVariantInteractionForEdge(group, selectedOption.id, nextOption.id)
    : null;
  return {
    group,
    selectedOption,
    selectedIndex,
    previousDisabled: !previousOption
      || !runtimeVariantUiButtonAllowed(group, selectedOption.id, previousOption.id),
    nextDisabled: !nextOption
      || !runtimeVariantUiButtonAllowed(group, selectedOption.id, nextOption.id),
    previousPresentation: runtimeTextPanelButtonPresentation(
      previousInteraction,
      group.control.previousLabel || "Previous",
      [0.2, 0.86],
    ),
    nextPresentation: runtimeTextPanelButtonPresentation(
      nextInteraction,
      group.control.nextLabel || "Next",
      [0.8, 0.86],
    ),
  };
}

function runtimeTextPanelButtonPresentation(record, fallbackLabel, fallbackPosition) {
  const configuration = runtimeInteractionConfiguration(record);
  const button = Array.isArray(configuration?.buttons)
    ? configuration.buttons.find((candidate) => normalizeRuntimeControllerAction(candidate?.action) === "select-variant")
      || configuration.buttons[0]
    : null;
  const authoredLayout = record?.overridden === true || record?.authored === true;
  return {
    id: String(button?.id || ""),
    label: String(button?.label || fallbackLabel || "Select").trim(),
    action: String(button?.action || "select-variant"),
    position: finiteInteractionArray(authoredLayout ? button?.position : fallbackPosition, 2, fallbackPosition)
      .map((component) => THREE.MathUtils.clamp(component, 0, 1)),
    size: finiteInteractionArray(authoredLayout ? button?.size : [0.32, 0.12], 2, [0.32, 0.12])
      .map((component) => THREE.MathUtils.clamp(component, 0.04, 1)),
  };
}

function applyRuntimeTextPanelButtonPresentation(control, presentation) {
  if (!control || !presentation) return;
  const label = String(presentation.label || "Select").trim();
  const position = finiteInteractionArray(presentation.position, 2, [0.5, 0.86]);
  const size = finiteInteractionArray(presentation.size, 2, [0.32, 0.12]);
  const widthRatio = THREE.MathUtils.clamp(size[0], 0.04, 1);
  const heightRatio = THREE.MathUtils.clamp(size[1], 0.04, 1);
  const x = THREE.MathUtils.clamp(position[0], widthRatio / 2, 1 - (widthRatio / 2));
  const y = THREE.MathUtils.clamp(position[1], heightRatio / 2, 1 - (heightRatio / 2));
  const signature = JSON.stringify([label, x, y, widthRatio, heightRatio]);
  if (control.userData.storyvrTextPanelPresentationSignature !== signature) {
    const previousGeometry = control.geometry;
    const previousTexture = control.material?.map;
    control.geometry = new THREE.PlaneGeometry(
      XR_TEXT_PANEL_WIDTH * widthRatio,
      XR_TEXT_PANEL_HEIGHT * heightRatio,
    );
    control.material.map = makeRuntimeTextPanelButtonTexture(label);
    control.material.needsUpdate = true;
    previousGeometry?.dispose?.();
    previousTexture?.dispose?.();
    control.userData.storyvrTextPanelPresentationSignature = signature;
  }
  control.position.set(
    (x - 0.5) * XR_TEXT_PANEL_WIDTH,
    (0.5 - y) * XR_TEXT_PANEL_HEIGHT,
    0.006,
  );
  control.userData.storyvrTextPanelLabel = label;
  control.userData.storyvrTextPanelButtonId = presentation.id || null;
}

function syncRuntimeTextPanelVariantControls(variantState) {
  const root = spatialTextPanel?.userData?.variantControlRoot;
  const previousButton = spatialTextPanel?.userData?.variantPreviousButton;
  const nextButton = spatialTextPanel?.userData?.variantNextButton;
  if (!root || !previousButton || !nextButton) return;
  root.visible = Boolean(variantState && (!variantState.previousDisabled || !variantState.nextDisabled));
  if (variantState) {
    applyRuntimeTextPanelButtonPresentation(previousButton, variantState.previousPresentation);
    applyRuntimeTextPanelButtonPresentation(nextButton, variantState.nextPresentation);
  }
  setRuntimeTextPanelControlDisabled(previousButton, !variantState || variantState.previousDisabled);
  setRuntimeTextPanelControlDisabled(nextButton, !variantState || variantState.nextDisabled);
  previousButton.visible = Boolean(variantState && !variantState.previousDisabled);
  nextButton.visible = Boolean(variantState && !variantState.nextDisabled);
  previousButton.userData.storyvrVariantGroupId = variantState?.group?.id || null;
  nextButton.userData.storyvrVariantGroupId = variantState?.group?.id || null;
}

function setRuntimeTextPanelControlDisabled(control, disabled) {
  if (!control) return;
  control.userData.storyvrTextPanelDisabled = Boolean(disabled);
  control.material.color.setHex(disabled ? 0x76817d : 0xffffff);
  control.material.opacity = disabled ? 0.48 : 1;
}

function setTextPanelMinimized(minimized) {
  textPanelMinimized = Boolean(minimized);
  readerPanel?.classList.toggle("minimized", textPanelMinimized);
  if (readerPanelToggle) {
    const label = textPanelMinimized ? "Restore text panel" : "Minimize text panel";
    readerPanelToggle.textContent = textPanelMinimized ? "Aa" : "\u2212";
    readerPanelToggle.setAttribute("aria-expanded", String(!textPanelMinimized));
    readerPanelToggle.setAttribute("aria-label", label);
    readerPanelToggle.title = label;
  }
  if (spatialTextPanel) {
    spatialTextPanel.userData.expandedRoot.visible = !textPanelMinimized;
    spatialTextPanel.userData.minimizedRoot.visible = textPanelMinimized;
    spatialTextPanel.userData.minimized = textPanelMinimized;
  }
  requestAnimationFrame(clampReaderPanelToViewport);
}

function configureReaderPanelMouseDragging() {
  if (!readerPanel) return;
  readerPanel.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || renderer.xr.isPresenting) return;
    const interactive = event.target.closest?.("button, a, input, select, textarea");
    const toggleTarget = Boolean(readerPanelToggle?.contains?.(event.target));
    if (interactive && !toggleTarget) return;
    const rect = readerPanel.getBoundingClientRect();
    readerPanelDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
      toggle: toggleTarget,
    };
  });
  readerPanel.addEventListener("pointermove", (event) => {
    if (!readerPanelDrag || readerPanelDrag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - readerPanelDrag.startX;
    const deltaY = event.clientY - readerPanelDrag.startY;
    if (!readerPanelDrag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    readerPanelDrag.moved = true;
    readerPanel.setPointerCapture?.(event.pointerId);
    if (readerPanelDrag.toggle) suppressReaderPanelToggleClick = true;
    const rect = readerPanel.getBoundingClientRect();
    const maximumLeft = Math.max(0, window.innerWidth - rect.width);
    const maximumTop = Math.max(0, window.innerHeight - rect.height);
    readerPanel.style.left = `${THREE.MathUtils.clamp(readerPanelDrag.left + deltaX, 0, maximumLeft)}px`;
    readerPanel.style.top = `${THREE.MathUtils.clamp(readerPanelDrag.top + deltaY, 0, maximumTop)}px`;
    readerPanel.classList.add("dragging");
    event.preventDefault();
  });
  const finishDrag = (event) => {
    if (!readerPanelDrag || readerPanelDrag.pointerId !== event.pointerId) return;
    const movedToggle = readerPanelDrag.moved && readerPanelDrag.toggle;
    readerPanel.releasePointerCapture?.(event.pointerId);
    readerPanel.classList.remove("dragging");
    readerPanelDrag = null;
    if (event.type === "pointercancel") suppressReaderPanelToggleClick = false;
    else if (movedToggle) {
      suppressReaderPanelToggleClick = true;
      setTimeout(() => {
        suppressReaderPanelToggleClick = false;
      }, 0);
    }
  };
  readerPanel.addEventListener("pointerup", finishDrag);
  readerPanel.addEventListener("pointercancel", finishDrag);
}

function clampReaderPanelToViewport() {
  if (!readerPanel || !readerPanel.style.left || !readerPanel.style.top) return;
  const rect = readerPanel.getBoundingClientRect();
  readerPanel.style.left = `${THREE.MathUtils.clamp(rect.left, 0, Math.max(0, window.innerWidth - rect.width))}px`;
  readerPanel.style.top = `${THREE.MathUtils.clamp(rect.top, 0, Math.max(0, window.innerHeight - rect.height))}px`;
}

function setRuntimeTextPanelReveal(panel, opacity) {
  if (!panel) return;
  const normalizedOpacity = Math.max(0, Math.min(1, Number(opacity) || 0));
  if (Math.abs((Number(panel.userData.spatialRevealOpacity) || 0) - normalizedOpacity) <= 0.001
    && panel.userData.spatialRevealOpacity !== undefined) return;
  panel.userData.spatialRevealOpacity = normalizedOpacity;
  panel.visible = normalizedOpacity > 0.001;
  panel.traverse((node) => {
    const materials = Array.isArray(node.material) ? node.material : [node.material].filter(Boolean);
    for (const material of materials) {
      material.transparent = true;
      material.opacity = normalizedOpacity;
    }
  });
}

function applyRuntimeTextPanelClearanceLock(panel, frameTime = performance.now()) {
  const lock = panel?.userData?.spatialClearanceLock;
  if (!lock?.position || !lock?.quaternion) return false;
  panel.position.copy(lock.position);
  panel.quaternion.copy(lock.quaternion);
  const state = panel.userData.spatialClearanceState;
  if (state && Number.isFinite(state.revealStartedAt)) {
    const revealOpacity = Math.min(1, Math.max(0, (frameTime - state.revealStartedAt) / SPATIAL_TEXT_CLEARANCE_REVEAL_MS));
    setRuntimeTextPanelReveal(panel, revealOpacity);
    if (revealOpacity >= 1) state.revealStartedAt = NaN;
  }
  panel.userData.spatialClearanceStatus = "locked";
  return true;
}

function lockRuntimeTextPanelClearance(panel, frameTime = performance.now()) {
  if (!panel || panel.userData.spatialClearanceLock) return false;
  panel.userData.spatialClearanceLock = {
    position: panel.position.clone(),
    quaternion: panel.quaternion.clone(),
  };
  const state = panel.userData.spatialClearanceState;
  if (state) state.locked = true;
  applyRuntimeTextPanelClearanceLock(panel, frameTime);
  return true;
}

function clearSpatialTextPanel() {
  if (!spatialTextPanel) return;
  spatialTextPanel.removeFromParent();
  spatialTextPanel.traverse((node) => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : [node.material].filter(Boolean);
    for (const material of materials) {
      material.map?.dispose?.();
      material.dispose?.();
    }
  });
  spatialTextPanel = null;
  xrTextPanelAttachedEntry = null;
  xrTextPanelGrabEntry = null;
  xrTextPanelGrabInput = null;
  xrTextPanelScrollGesture = null;
}

function updateSpatialTextPanelPose(frameTime = performance.now()) {
  if (!spatialTextPanel) return;
  if (!renderer.xr.isPresenting) {
    spatialTextPanel.visible = false;
    return;
  }
  if (xrTextPanelGrabEntry) {
    spatialTextPanel.visible = true;
    return;
  }
  const preferred = preferredXrTextPanelEntry();
  if (!preferred) {
    spatialTextPanel.visible = false;
    return;
  }
  if (xrTextPanelAttachedEntry !== preferred || spatialTextPanel.parent !== preferred.anchor) {
    attachSpatialTextPanelToEntry(preferred);
  }
  spatialTextPanel.visible = true;
}

function positionSpatialTextPanelAtFocus(focus, offset, frameTime) {
  const target = spatialTextPanel.userData.spatialFocusTarget || new THREE.Vector3();
  const current = spatialTextPanel.userData.spatialFocusCurrent || new THREE.Vector3();
  const previousFrameTime = Number(spatialTextPanel.userData.spatialFocusFrameTime);
  target.copy(focus).add(offset);
  if (!spatialTextPanel.userData.spatialFocusInitialized || !runtimeSpatialTextSceneChanging()) {
    current.copy(target);
    spatialTextPanel.userData.spatialFocusInitialized = true;
  } else {
    const deltaSeconds = Number.isFinite(previousFrameTime)
      ? Math.min(0.1, Math.max(0, (frameTime - previousFrameTime) / 1000))
      : 1 / 60;
    current.lerp(target, 1 - Math.exp(-18 * deltaSeconds));
  }
  spatialTextPanel.userData.spatialFocusTarget = target;
  spatialTextPanel.userData.spatialFocusCurrent = current;
  spatialTextPanel.userData.spatialFocusFrameTime = frameTime;
  spatialTextPanel.position.copy(current);
}

function runtimeSpatialTextSceneChanging() {
  return Boolean(
    activeSourceAnimation && ["loop", "segment"].includes(activeSourceAnimation.mode)
  );
}

function applySpatialTextOrientation(renderCamera) {
  if (!spatialTextPanel || !spatialTextPlacement || spatialTextPanel.parent === camera) return;
  if (applyRuntimeTextPanelClearanceLock(spatialTextPanel)) return;
  const policy = String(spatialTextPlacement.orientationPolicy || (spatialTextPlacement.facesReader ? "reader-facing" : "fixed"));
  if (!["yaw-to-reader", "billboard", "reader-facing-yaw", "reader-facing"].includes(policy)) return;
  const facingCamera = renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : renderCamera;
  const target = facingCamera.getWorldPosition(spatialTextOrientationTarget);
  if (["yaw-to-reader", "reader-facing-yaw"].includes(policy)) {
    target.y = spatialTextPanel.getWorldPosition(spatialTextPanelWorldPosition).y;
  }
  spatialTextPanel.lookAt(target);
}

function applySpatialTextCollisionClearance(renderCamera) {
  const clearance = spatialTextPlacement?.clearance;
  if (!spatialTextPanel) return;
  if (applyRuntimeTextPanelClearanceLock(spatialTextPanel)) return;
  if (!clearance?.enabled || !activeModel) {
    spatialTextPanel.userData.spatialClearanceAwaitingFirstCommit = false;
    setRuntimeTextPanelReveal(spatialTextPanel, 1);
    return;
  }
  if (spatialTextPlacement.anchorAssetId && activeModelAssetId() !== spatialTextPlacement.anchorAssetId) {
    spatialTextPanel.userData.spatialClearanceStatus = "unresolved-anchor";
    spatialTextPanel.userData.spatialClearanceAwaitingFirstCommit = false;
    setRuntimeTextPanelReveal(spatialTextPanel, 1);
    return;
  }
  const facingCamera = renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : renderCamera;
  const cameraPosition = facingCamera?.getWorldPosition?.(spatialTextCameraPosition);
  if (!cameraPosition) {
    spatialTextPanel.userData.spatialClearanceAwaitingFirstCommit = false;
    setRuntimeTextPanelReveal(spatialTextPanel, 1);
    return;
  }
  const sceneChanging = runtimeSpatialTextSceneChanging();
  const cacheKey = `${spatialTextPanel.userData.beatId || beats[activeIndex]?.id || activeIndex}:${activeModelAssetId() || "none"}`;
  resolveRuntimeTextPanelClearance(
    spatialTextPanel,
    activeModel,
    cameraPosition,
    clearance,
    sceneChanging,
    cacheKey,
    spatialTextPlacement.orientationPolicy,
  );
}

function resolveRuntimeTextPanelClearance(
  panel,
  collisionRoot,
  cameraPosition,
  clearance,
  sceneChanging = false,
  cacheKey = "",
  orientationPolicy = "fixed",
) {
  const panelMesh = panel?.children?.find((node) => node.isMesh && node.geometry?.type === "PlaneGeometry");
  if (!panelMesh || !collisionRoot || !cameraPosition) {
    setRuntimeTextPanelReveal(panel, 1);
    return 0;
  }
  const basePosition = panel.position.clone();
  const direction = cameraPosition.clone().sub(basePosition);
  const cameraDistance = direction.length();
  if (cameraDistance <= 0.5) {
    setRuntimeTextPanelReveal(panel, 1);
    return 0;
  }
  direction.normalize();
  const maximum = Math.min(clearance.maxPushDistance, Math.max(0, cameraDistance - 0.5));
  const correctionMargin = Math.min(0.02, Math.max(0.005, clearance.minSurfaceDistance * 0.075));
  const now = performance.now();
  const previous = panel.userData.spatialClearanceState || (cacheKey ? spatialTextClearanceCache.get(cacheKey) : null);
  const baseMoved = Boolean(previous?.basePosition) && previous.basePosition.distanceToSquared(basePosition) > 0.0004;
  const cameraMoved = Boolean(previous?.cameraPosition) && previous.cameraPosition.distanceToSquared(cameraPosition) > 0.0004;
  let pushDistance = Math.max(0, Number(previous?.pushDistance) || 0);
  let probePushDistance = Math.max(0, Number(previous?.probePushDistance ?? pushDistance) || 0);
  let displayedPushDistance = Math.max(0, Number(previous?.displayedPushDistance ?? pushDistance) || 0);
  let saturated = previous?.saturated === true;
  let probeSaturated = previous?.probeSaturated === true;
  let hasCommittedClearance = previous?.hasCommittedClearance === true;
  let pushTransitionFrom = Math.max(0, Number(previous?.pushTransitionFrom ?? displayedPushDistance) || 0);
  let pushTransitionStartedAt = Number(previous?.pushTransitionStartedAt);
  let revealStartedAt = Number(previous?.revealStartedAt);
  if (hasCommittedClearance && Number.isFinite(pushTransitionStartedAt)) {
    const transitionProgress = Math.min(1, Math.max(0, (now - pushTransitionStartedAt) / SPATIAL_TEXT_CLEARANCE_TRANSITION_MS));
    const easedProgress = 1 - ((1 - transitionProgress) ** 3);
    displayedPushDistance = THREE.MathUtils.lerp(pushTransitionFrom, pushDistance, easedProgress);
    if (transitionProgress >= 1) {
      displayedPushDistance = pushDistance;
      pushTransitionFrom = pushDistance;
      pushTransitionStartedAt = NaN;
    }
  } else if (hasCommittedClearance) {
    displayedPushDistance = pushDistance;
  }
  let remainingSettledPasses = Math.max(0, Number(previous?.remainingSettledPasses) || 0);
  let needsSettledVerification = previous?.needsSettledVerification === true;
  let sampleCursor = Math.max(0, Number(previous?.sampleCursor) || 0);
  let sampleDeficit = Math.max(0, Number(previous?.sampleDeficit) || 0);
  let sampleGrid = Math.max(2, Number(previous?.sampleGrid) || 3);
  let sampleSettled = previous?.sampleSettled === true;
  const initialVerificationPending = !hasCommittedClearance;
  const settledAfterAnimation = previous?.sceneChanging === true && !sceneChanging;
  const elapsedSinceCheck = now - (previous?.checkedAt || 0);
  const sampleBatchInterrupted = sampleCursor > 0 && (
    (sampleSettled && !initialVerificationPending && (sceneChanging || baseMoved || cameraMoved))
    || (!sampleSettled && settledAfterAnimation)
  );
  const continueSampleBatch = sampleCursor > 0 && !sampleBatchInterrupted;
  const continueSettledVerification = !continueSampleBatch
    && remainingSettledPasses > 0
    && (initialVerificationPending || (!sceneChanging && !baseMoved && !cameraMoved));
  const stableVerificationDue = hasCommittedClearance
    && !sceneChanging
    && !baseMoved
    && !cameraMoved
    && needsSettledVerification
    && elapsedSinceCheck >= clearance.recheckIntervalMs;
  const startInitialVerification = initialVerificationPending
    && (!previous || (sampleCursor === 0 && remainingSettledPasses === 0));
  const startSettledVerification = startInitialVerification
    || (hasCommittedClearance && !sceneChanging && (settledAfterAnimation || stableVerificationDue));
  const movingRecheckDue = sampleBatchInterrupted || (
    (sceneChanging || baseMoved || cameraMoved)
    && (!previous || elapsedSinceCheck >= clearance.recheckIntervalMs)
  );
  const recheckDue = continueSampleBatch || startSettledVerification || continueSettledVerification || movingRecheckDue;
  let nextState = null;
  if (recheckDue) {
    const settledVerification = continueSampleBatch
      ? sampleSettled
      : startSettledVerification || continueSettledVerification;
    if (startSettledVerification) {
      probePushDistance = 0;
      probeSaturated = false;
      remainingSettledPasses = 4;
      sampleCursor = 0;
      sampleDeficit = 0;
    } else if (!continueSampleBatch && !settledVerification) {
      probePushDistance = 0;
      probeSaturated = false;
      remainingSettledPasses = 0;
    }
    if (!continueSampleBatch) {
      sampleCursor = 0;
      sampleDeficit = 0;
      sampleGrid = clearance.sampleGrid;
      sampleSettled = settledVerification;
    }
    collisionRoot.updateWorldMatrix(true, true);
    const collisionProxy = runtimeVisibleTextCollisionProxy(collisionRoot, now);
    panel.position.copy(basePosition).addScaledVector(direction, probePushDistance);
    orientRuntimeTextPanelForClearance(panel, cameraPosition, orientationPolicy);
    panel.updateWorldMatrix(true, true);
    const sampleResult = runtimeTextPanelClearanceDeficitBatch(
      panelMesh,
      collisionProxy,
      cameraPosition,
      clearance.minSurfaceDistance,
      sampleGrid,
      sampleCursor,
      renderer.xr.isPresenting
        ? SPATIAL_TEXT_CLEARANCE_SAMPLES_PER_XR_FRAME
        : SPATIAL_TEXT_CLEARANCE_SAMPLES_PER_FRAME,
      sampleDeficit,
    );
    sampleCursor = sampleResult.complete ? 0 : sampleResult.nextIndex;
    sampleDeficit = sampleResult.deficit;
    let verificationCompleted = false;
    if (sampleResult.complete) {
      const deficit = sampleDeficit;
      sampleDeficit = 0;
      if (deficit <= 0.002) {
        remainingSettledPasses = 0;
        if (settledVerification) needsSettledVerification = false;
        verificationCompleted = true;
      } else {
        const nextPush = Math.min(maximum, probePushDistance + deficit + correctionMargin);
        if (nextPush <= probePushDistance + 0.001) {
          probeSaturated = true;
          remainingSettledPasses = 0;
        }
        probePushDistance = nextPush;
        if (probePushDistance >= maximum - 0.001) probeSaturated = true;
        if (settledVerification) {
          remainingSettledPasses = probeSaturated ? 0 : Math.max(0, remainingSettledPasses - 1);
          needsSettledVerification = remainingSettledPasses > 0;
          verificationCompleted = remainingSettledPasses === 0;
        } else {
          verificationCompleted = true;
        }
      }
    }
    if (!settledVerification) needsSettledVerification = true;
    if (verificationCompleted) {
      const previouslyCommitted = hasCommittedClearance;
      const candidatePushDistance = probePushDistance;
      const pushesFartherOut = candidatePushDistance > pushDistance + 0.001;
      const settledInwardChange = settledVerification
        && pushDistance - candidatePushDistance >= SPATIAL_TEXT_CLEARANCE_INWARD_HYSTERESIS;
      const shouldCommitCandidate = !previouslyCommitted || pushesFartherOut || settledInwardChange;
      if (shouldCommitCandidate) {
        pushDistance = candidatePushDistance;
        saturated = probeSaturated;
        hasCommittedClearance = true;
        if (!previouslyCommitted) {
          displayedPushDistance = pushDistance;
          pushTransitionFrom = pushDistance;
          pushTransitionStartedAt = NaN;
          revealStartedAt = now;
        } else if (Math.abs(pushDistance - displayedPushDistance) > 0.001) {
          pushTransitionFrom = displayedPushDistance;
          pushTransitionStartedAt = now;
        } else {
          displayedPushDistance = pushDistance;
          pushTransitionFrom = pushDistance;
          pushTransitionStartedAt = NaN;
        }
      }
    }
    nextState = {
      basePosition: basePosition.clone(),
      cameraPosition: cameraPosition.clone(),
      checkedAt: now,
      pushDistance,
      probePushDistance,
      displayedPushDistance,
      saturated,
      probeSaturated,
      hasCommittedClearance,
      pushTransitionFrom,
      pushTransitionStartedAt,
      revealStartedAt,
      sceneChanging,
      remainingSettledPasses,
      needsSettledVerification,
      sampleCursor,
      sampleDeficit,
      sampleGrid,
      sampleSettled,
    };
  } else if (previous) {
    nextState = {
      ...previous,
      displayedPushDistance,
      pushTransitionFrom,
      pushTransitionStartedAt,
      revealStartedAt,
    };
  }
  if (nextState) {
    if (nextState.hasCommittedClearance) {
      let revealOpacity = 1;
      if (Number.isFinite(nextState.revealStartedAt)) {
        revealOpacity = Math.min(1, Math.max(0, (now - nextState.revealStartedAt) / SPATIAL_TEXT_CLEARANCE_REVEAL_MS));
        if (revealOpacity >= 1) nextState.revealStartedAt = NaN;
      }
      panel.userData.spatialClearanceAwaitingFirstCommit = false;
      setRuntimeTextPanelReveal(panel, revealOpacity);
    } else {
      panel.userData.spatialClearanceAwaitingFirstCommit = true;
      setRuntimeTextPanelReveal(panel, 0);
    }
    panel.userData.spatialClearanceState = nextState;
    if (cacheKey) {
      if (spatialTextClearanceCache.size >= SPATIAL_TEXT_CACHE_LIMIT && !spatialTextClearanceCache.has(cacheKey)) {
        spatialTextClearanceCache.delete(spatialTextClearanceCache.keys().next().value);
      }
      spatialTextClearanceCache.set(cacheKey, nextState);
    }
  }
  const renderedPushDistance = Math.max(0, Number(nextState?.displayedPushDistance ?? displayedPushDistance) || 0);
  panel.position.copy(basePosition).addScaledVector(direction, renderedPushDistance);
  orientRuntimeTextPanelForClearance(panel, cameraPosition, orientationPolicy);
  panel.userData.spatialClearanceStatus = !hasCommittedClearance
    ? "checking"
    : saturated ? "maximum-push" : pushDistance > 0.002 ? "cleared" : "clear";
  panel.userData.spatialClearancePushDistance = renderedPushDistance;
  panel.userData.spatialClearanceCommittedPushDistance = pushDistance;
  panel.userData.spatialClearanceProbePushDistance = probePushDistance;
  const resolvedState = panel.userData.spatialClearanceState;
  if (
    resolvedState?.hasCommittedClearance
    && !resolvedState.needsSettledVerification
    && resolvedState.sampleCursor === 0
    && resolvedState.remainingSettledPasses === 0
  ) lockRuntimeTextPanelClearance(panel, now);
  return renderedPushDistance;
}

function orientRuntimeTextPanelForClearance(panel, cameraPosition, orientationPolicy) {
  const policy = String(orientationPolicy || "fixed");
  if (!panel || !cameraPosition || !["yaw-to-reader", "billboard", "reader-facing-yaw", "reader-facing"].includes(policy)) return;
  const target = spatialTextOrientationTarget.copy(cameraPosition);
  if (["yaw-to-reader", "reader-facing-yaw"].includes(policy)) {
    panel.updateWorldMatrix(true, false);
    target.y = panel.getWorldPosition(spatialTextPanelWorldPosition).y;
  }
  panel.lookAt(target);
}

function runtimeVisibleTextCollisionProxy(collisionRoot, now = performance.now()) {
  if (
    spatialTextCollisionProxyCache.root === collisionRoot
    && now - spatialTextCollisionProxyCache.checkedAt < 8
  ) return spatialTextCollisionProxyCache.entries;
  const proxy = spatialTextCollisionProxyCache.root === collisionRoot
    ? spatialTextCollisionProxyCache.entries
    : [];
  proxy.length = 0;
  collisionRoot.traverseVisible((object) => {
    if (!object.isMesh || !object.geometry) return;
    const entry = spatialTextCollisionEntryByMesh.get(object) || { mesh: object, bounds: null };
    const deforming = object.isSkinnedMesh || (Array.isArray(object.morphTargetInfluences) && object.morphTargetInfluences.length > 0);
    let bounds = null;
    if (!deforming) {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (object.geometry.boundingBox) {
        bounds = spatialTextCollisionBoundsByMesh.get(object) || new THREE.Box3();
        bounds.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
        spatialTextCollisionBoundsByMesh.set(object, bounds);
      }
    }
    entry.bounds = bounds;
    spatialTextCollisionEntryByMesh.set(object, entry);
    proxy.push(entry);
  });
  spatialTextCollisionProxyCache = { root: collisionRoot, checkedAt: now, entries: proxy };
  return proxy;
}

function runtimeTextPanelClearanceDeficit(panelMesh, collisionProxy, cameraPosition, minimumDistance, gridSize) {
  return runtimeTextPanelClearanceDeficitBatch(
    panelMesh,
    collisionProxy,
    cameraPosition,
    minimumDistance,
    gridSize,
    0,
    Infinity,
    0,
  ).deficit;
}

function runtimeTextPanelClearanceDeficitBatch(
  panelMesh,
  collisionProxy,
  cameraPosition,
  minimumDistance,
  gridSize,
  startIndex = 0,
  sampleLimit = Infinity,
  initialDeficit = 0,
) {
  const width = Number(panelMesh.geometry?.parameters?.width) || 1.35;
  const height = Number(panelMesh.geometry?.parameters?.height) || 0.72;
  const grid = Math.max(2, Math.min(5, Math.round(Number(gridSize) || 3)));
  const totalSamples = grid * grid;
  const firstSample = Math.max(0, Math.min(totalSamples, Math.floor(Number(startIndex) || 0)));
  const samplesThisBatch = Number.isFinite(Number(sampleLimit))
    ? Math.max(1, Math.floor(Number(sampleLimit)))
    : totalSamples;
  const sampleEnd = Math.min(totalSamples, firstSample + samplesThisBatch);
  const raycaster = spatialTextClearanceRaycaster;
  const point = spatialTextClearancePoint;
  const direction = spatialTextClearanceDirection;
  const candidateMeshes = spatialTextClearanceCandidates;
  const hits = spatialTextClearanceHits;
  let requiredPush = Math.max(0, Number(initialDeficit) || 0);
  for (let sampleIndex = firstSample; sampleIndex < sampleEnd; sampleIndex += 1) {
    const xIndex = sampleIndex % grid;
    const yIndex = Math.floor(sampleIndex / grid);
    point.set(
      (xIndex / (grid - 1) - 0.5) * width,
      (yIndex / (grid - 1) - 0.5) * height,
      0,
    );
    panelMesh.localToWorld(point);
    direction.copy(point).sub(cameraPosition);
    const panelDistance = direction.length();
    if (panelDistance <= 0.001) continue;
    direction.normalize();
    raycaster.set(cameraPosition, direction);
    raycaster.near = 0.001;
    raycaster.far = panelDistance + Math.max(5, minimumDistance * 4);
    candidateMeshes.length = 0;
    for (const entry of collisionProxy || []) {
      if (!entry.bounds || raycaster.ray.intersectsBox(entry.bounds)) candidateMeshes.push(entry.mesh);
    }
    if (!candidateMeshes.length) continue;
    hits.length = 0;
    raycaster.intersectObjects(candidateMeshes, false, hits);
    const hit = hits[0];
    if (!hit) continue;
    const surfaceGap = hit.distance - panelDistance;
    requiredPush = Math.max(requiredPush, minimumDistance - surfaceGap);
  }
  return {
    deficit: Math.max(0, requiredPush),
    nextIndex: sampleEnd,
    complete: sampleEnd >= totalSamples,
  };
}

function cacheSpatialTextPoint(cache, key, point, mode, checkedAt) {
  if (cache.size >= SPATIAL_TEXT_CACHE_LIMIT && !cache.has(key)) cache.delete(cache.keys().next().value);
  cache.set(key, { point: point.clone(), mode, checkedAt });
}

function runtimeSpatialTextMotionMode() {
  if (activeSourceAnimation?.mode) return String(activeSourceAnimation.mode);
  return "static";
}

function activeSpatialModelEntry(anchorAssetId = null) {
  if (activeModel && (!anchorAssetId || activeModelAssetId() === anchorAssetId)) {
    return { asset: activeModelAsset, model: activeModel, playback: activeSourceAnimation };
  }
  if (!anchorAssetId) return null;
  return activeSupplementalModelEntries.find((entry) => entry.asset?.id === anchorAssetId) || null;
}

function runtimeSourceCameraFocus(anchorAssetId = null, now = performance.now()) {
  const modelEntry = activeSpatialModelEntry(anchorAssetId);
  const assetId = anchorAssetId || modelEntry?.asset?.id || activeModelAssetId();
  const cue = runtimeSourceSpatialCueForBeat(beats[activeIndex]?.id, assetId);
  const sourceCamera = modelEntry ? modelEntry.playback?.sourceCamera : activeSourceAnimation?.sourceCamera;
  const model = modelEntry?.model || activeModel;
  if (!cue || !sourceCamera || !model) return null;
  const mode = String(modelEntry?.playback?.mode || runtimeSpatialTextMotionMode());
  const cacheKey = `${beats[activeIndex]?.id || activeIndex}:${assetId || "none"}:${model.uuid}:${sourceCamera.uuid}`;
  const cached = spatialTextFocusCache.get(cacheKey);
  const refreshesDuringMotion = runtimeSpatialTextSceneChanging();
  if (
    cached?.mode === mode
    && (!refreshesDuringMotion || now - cached.checkedAt < SOURCE_FOCUS_DYNAMIC_REFRESH_MS)
  ) return cached.point.clone();
  sourceCamera.updateWorldMatrix(true, false);
  model.updateWorldMatrix(true, true);
  const origin = sourceCamera.getWorldPosition(spatialTextFocusOrigin);
  const direction = sourceCamera.getWorldDirection(spatialTextFocusDirection).normalize();
  spatialTextFocusRaycaster.set(origin, direction);
  spatialTextFocusRaycaster.near = 0.001;
  spatialTextFocusRaycaster.far = Number(sourceCamera.far) || 1000;
  spatialTextFocusCandidates.length = 0;
  const collisionProxy = model === activeModel
    ? runtimeVisibleTextCollisionProxy(activeModel, now)
    : runtimeVisibleTextCollisionProxy(model, now);
  for (const entry of collisionProxy) {
    if (!entry.bounds || spatialTextFocusRaycaster.ray.intersectsBox(entry.bounds)) {
      spatialTextFocusCandidates.push(entry.mesh);
    }
  }
  spatialTextFocusHits.length = 0;
  spatialTextFocusRaycaster.intersectObjects(spatialTextFocusCandidates, false, spatialTextFocusHits);
  const focus = spatialTextFocusHits[0]?.point?.clone?.() || runtimeActiveModelFocus(assetId, now);
  if (!focus) return null;
  cacheSpatialTextPoint(spatialTextFocusCache, cacheKey, focus, mode, now);
  return focus.clone();
}

function activeModelAssetId() {
  return activeModelAsset?.id || null;
}

function runtimeActiveModelFocus(anchorAssetId = null, now = performance.now()) {
  const modelEntry = activeSpatialModelEntry(anchorAssetId);
  const model = modelEntry?.model || activeModel;
  if (!model) return null;
  const assetId = anchorAssetId || modelEntry?.asset?.id || activeModelAssetId();
  const mode = String(modelEntry?.playback?.mode || runtimeSpatialTextMotionMode());
  const cacheKey = `${beats[activeIndex]?.id || activeIndex}:${assetId || "none"}:${model.uuid}`;
  const cached = spatialTextModelFocusCache.get(cacheKey);
  const refreshesDuringMotion = runtimeSpatialTextSceneChanging();
  if (
    cached?.mode === mode
    && (!refreshesDuringMotion || now - cached.checkedAt < SOURCE_FOCUS_DYNAMIC_REFRESH_MS)
  ) return cached.point.clone();
  spatialTextActiveModelBounds.setFromObject(model);
  if (spatialTextActiveModelBounds.isEmpty()) return null;
  const focus = spatialTextActiveModelBounds.getCenter(new THREE.Vector3());
  cacheSpatialTextPoint(spatialTextModelFocusCache, cacheKey, focus, mode, now);
  return focus.clone();
}

function runtimeSpatialAnchorFallback() {
  return new THREE.Vector3(0, 1.25, -0.8);
}

function runtimeTextPanelVariantLayout(canvasHeight) {
  const height = Number.isFinite(Number(canvasHeight)) && Number(canvasHeight) > 0
    ? Number(canvasHeight)
    : 560;
  return {
    bodyMaxLines: 5,
    statusBaseline: Math.round(height * 0.74),
    controlBandTop: Math.round(height * 0.78),
  };
}

function makeRuntimeTextPanelTexture(title, text, placement, variantState = null, requestedScrollLine = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 560;
  const context = canvas.getContext("2d");
  const variantLayout = variantState ? runtimeTextPanelVariantLayout(canvas.height) : null;
  context.fillStyle = "rgba(8, 22, 19, 1)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(110, 216, 194, 0.9)";
  context.lineWidth = 10;
  context.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  context.fillStyle = "#6ed8c2";
  context.font = "700 46px sans-serif";
  context.fillText(String(title || "Story beat").slice(0, 58), 54, 78);
  context.fillStyle = "#f6f2e7";
  context.font = "34px sans-serif";
  const pagination = drawRuntimeWrappedText(
    context,
    String(text || ""),
    54,
    142,
    916,
    48,
    variantLayout?.bodyMaxLines || 8,
    requestedScrollLine,
  );
  if (variantState) {
    context.fillStyle = "rgba(246, 242, 231, 0.72)";
    context.font = "700 25px sans-serif";
    context.fillText(
      `${variantState.selectedOption.label} \u00b7 ${variantState.selectedIndex + 1} of ${variantState.group.options.length}`,
      54,
      variantLayout.statusBaseline,
      916,
    );
    context.strokeStyle = "rgba(110, 216, 194, 0.24)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(54, variantLayout.controlBandTop);
    context.lineTo(canvas.width - 54, variantLayout.controlBandTop);
    context.stroke();
  }
  context.fillStyle = "rgba(246, 242, 231, 0.58)";
  context.font = "24px sans-serif";
  const footer = pagination.maxScrollLine > 0
    ? `Hold Trigger and move vertically to scroll \u00b7 lines ${pagination.scrollLine + 1}\u2013${Math.min(pagination.lineCount, pagination.scrollLine + pagination.maxLines)} of ${pagination.lineCount} \u00b7 Grip to move`
    : "Trigger for UI buttons \u00b7 Grip to grab";
  context.fillText(footer, 54, 526, 916);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.userData.storyvrTextPanelPagination = pagination;
  return texture;
}

function runtimeWrappedTextLines(context, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawRuntimeWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines, requestedScrollLine = 0) {
  const lines = runtimeWrappedTextLines(context, text, maxWidth);
  const maxScrollLine = Math.max(0, lines.length - maxLines);
  const scrollLine = Math.max(0, Math.min(maxScrollLine, Math.round(Number(requestedScrollLine) || 0)));
  lines.slice(scrollLine, scrollLine + maxLines).forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight);
  });
  return {
    lineCount: lines.length,
    maxLines,
    maxScrollLine,
    scrollLine,
  };
}

function loadModel(source) {
  if (modelCache.has(source)) return modelCache.get(source);
  const loader = createGltfLoader();
  const promise = loader.loadAsync(source).then((gltf) => {
    for (const [object, association] of gltf.parser?.associations || []) {
      const nodeIndex = Number(association?.nodes);
      if (!object?.isObject3D || !Number.isInteger(nodeIndex) || nodeIndex < 0) continue;
      object.userData = { ...object.userData, storyvrGltfNodeIndex: nodeIndex };
    }
    const cameras = Array.isArray(gltf.cameras) ? gltf.cameras : [];
    cameras.forEach((sourceCamera, cameraIndex) => {
      sourceCamera.userData.storyvrSourceCameraIndex = cameraIndex;
    });
    return {
      scene: gltf.scene,
      animations: Array.isArray(gltf.animations) ? gltf.animations : [],
      cameras,
    };
  });
  modelCache.set(source, promise);
  return promise;
}

function clonedSourceCameras(root, sourceCameras) {
  const byIndex = new Map();
  const fallback = [];
  root?.traverse((node) => {
    if (!node.isCamera) return;
    fallback.push(node);
    const sourceIndex = Number(node.userData?.storyvrSourceCameraIndex);
    if (Number.isInteger(sourceIndex) && sourceIndex >= 0) byIndex.set(sourceIndex, node);
  });
  return (sourceCameras || []).map((sourceCamera, index) => (
    byIndex.get(index)
      || fallback.find((cameraCandidate) => sourceCamera?.name && cameraCandidate.name === sourceCamera.name)
      || fallback[index]
      || null
  )).filter(Boolean);
}

function frameModel(model, options = {}) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;
  const target = modelFrameTarget();
  const scale = target / maxAxis;
  model.scale.multiplyScalar(scale);
  model.position.x -= center.x * scale;
  model.position.z -= center.z * scale;
  model.position.y -= (options.groundAligned === true ? box.min.y : center.y) * scale;
}

function sharedTimelineGroundAligned(contract) {
  return String(contract?.framing?.verticalAlignment || "").trim().toLowerCase() === "ground";
}

function runtimeSpatialEntityGroundAligned(entity, sharedTimelineContract = null, spatialRelations = null) {
  if (
    entity
    && String(spatialRelations?.inferenceVersion || "") !== CURRENT_SPATIAL_RELATIONS_INFERENCE_VERSION
  ) return true;
  const supplied = String(entity?.verticalAlignment || "").trim().toLowerCase();
  if (["ground", "grounded", "floor"].includes(supplied)) return true;
  if (["center", "centered", "centre", "centred"].includes(supplied)) return false;
  if (entity) return true;
  return sharedTimelineGroundAligned(sharedTimelineContract);
}

function activeRuntimeTopologyKind() {
  const sceneRecord = runtimeSpatialSceneForBeat();
  const topology = sceneRecord?.topology;
  const label = typeof topology === "string" ? topology : topology?.kind || topology?.label || "";
  return label ? topologyKindFromLabel(label) : runtimeTopologyKind;
}

function activeRuntimeViewpointKind(sceneRecord = runtimeSpatialSceneForBeat()) {
  const viewpoint = String(sceneRecord?.viewpoint || "").trim();
  return viewpoint ? topologyViewpointKind({ viewpoint }) : fallbackReaderViewpoint;
}

function modelFrameTarget() {
  const viewpoint = activeRuntimeViewpointKind();
  if (viewpoint === "egocentric" && activeRuntimeTopologyKind() === "single") return 5.4;
  if (viewpoint === "egocentric") return 2.7;
  return 1.9;
}

function modelRootPositionForBeat(beat) {
  if (activeRuntimeViewpointKind() !== "egocentric") return new THREE.Vector3(0, 1.18, 0);
  if (runtimeTopologyKind === "single") return new THREE.Vector3(0, 1.18, -0.18);
  const count = Math.max(beats.filter(modelAssetForBeat).length || beats.length, 1);
  const modelIndex = Math.max(0, beats.filter(modelAssetForBeat).findIndex((candidate) => candidate.id === beat.id));
  const angle = (-Math.PI / 2) + ((Math.PI * 2 * Math.max(modelIndex, 0)) / count);
  const radius = runtimeTopologyKind === "map" ? 2.75 : 2.45;
  return new THREE.Vector3(Math.cos(angle) * radius, 1.05, Math.sin(angle) * radius);
}

function updateHabitat() {
  if (habitat) scene.remove(habitat);
  if (environmentLoaded) {
    habitat = null;
    return;
  }
  const viewpoint = activeRuntimeViewpointKind();
  habitat = new THREE.Group();
  if (!finalTuning.directives.hideGroundCircles) {
    const ringRadius = viewpoint === "egocentric" ? (runtimeTopologyKind === "single" ? 2.75 : 2.55) : 2.05;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(ringRadius, 0.015, 8, 96),
      new THREE.MeshStandardMaterial({ color: 0x6ed8c2, transparent: true, opacity: 0.5 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    habitat.add(ring);
  }
  scene.add(habitat);
}

function createRoom() {
  const room = new THREE.Group();
  const floorGeometry = finalTuning.directives.hideGroundCircles
    ? new THREE.PlaneGeometry(11, 11)
    : new THREE.CircleGeometry(6.5, 96);
  const floor = new THREE.Mesh(
    floorGeometry,
    new THREE.MeshStandardMaterial({ color: 0x151a15, roughness: 0.92, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  room.add(floor);

  const grid = new THREE.GridHelper(11, 22, 0x2a3a33, 0x18221e);
  grid.position.y = 0.01;
  room.add(grid);
  scene.add(room);
  return room;
}

function configureCameraForTopology() {
  if (activeRuntimeViewpointKind() !== "egocentric") return;
  controls.minDistance = 0.05;
  controls.maxDistance = runtimeTopologyKind === "single" ? 7 : 9;
  if (runtimeTopologyKind === "single") {
    camera.position.set(0, 1.35, 0.24);
    controls.target.set(0, 1.24, -0.92);
    return;
  }
  camera.position.set(0, 1.45, 0.18);
  controls.target.set(0, 1.28, -1.35);
}

function topologyViewpointKind(option) {
  const text = String(option?.viewpoint || "").toLowerCase();
  if (text.includes("ego")) return "egocentric";
  if (text.includes("exo")) return "exocentric";
  return "exocentric";
}

function topologyKindFromLabel(label) {
  const text = String(label || "").toLowerCase();
  if (text.includes("single")) return "single";
  if (text.includes("map") || text.includes("terrain") || text.includes("network")) return "map";
  if (text.includes("collection") || text.includes("constellation")) return "constellation";
  return "single";
}

function dynamicGeometryKindFromLabel(label) {
  const text = String(label || "").toLowerCase();
  if (text.includes("no dynamics")) return "none";
  if (text.includes("flow") || text.includes("particles")) return "flow";
  if (text.includes("scale") || text.includes("zoom")) return "zoom";
  if (text.includes("highlight") || text.includes("focus")) return "focus";
  return "motion";
}

function render(frameTime = performance.now(), xrFrame = null) {
  alignXrEntryPose(xrFrame);
  const rawDelta = Math.max(0, (frameTime - lastFrameTime) / 1000);
  const delta = Math.min(rawDelta, 0.1);
  lastFrameTime = frameTime;
  elapsedSeconds += delta;
  updateSourceAnimation(delta, frameTime);
  updateActivePointCloudEffects();
  updateProceduralDynamics(delta);
  updateRuntimeDirectManipulation();
  updateSpatialTextPanelPose(frameTime);
  updateXrControllerVisuals();
  updateXrTextPanelInteractionRays();
  updateConfiguredControllerInteractions();
  updateRuntimeDirectManipulationCues();
  updatePhysicalTraversal();
  if (!renderer.xr.isPresenting) {
    updateDesktopKeyboardMovement(delta);
    controls.update();
    stabilizeDesktopReaderLook();
  }
  const renderCamera = activeRenderCamera();
  syncSourcePlaybackPresentation(activeSourceAnimation);
  updateSharedTimelineAnnotations(activeSourceAnimation, renderCamera);
  updateRuntimeAttentionGuidance(renderCamera, delta);
  renderer.render(scene, renderCamera);
}

function sourcePlaybackPointCloudTime(playback) {
  if (!playback) return null;
  if (playback.sharedTimeline) {
    return sharedTimelineTimeSeconds(playback.timelineDurationSeconds, playback.currentProgress ?? 0);
  }
  const actionTime = Number(playback.actions?.[0]?.time);
  if (Number.isFinite(actionTime)) return actionTime;
  const mixerTime = Number(playback.mixer?.time);
  return Number.isFinite(mixerTime) ? mixerTime : null;
}

function updateActivePointCloudEffects() {
  const activeTime = sourcePlaybackPointCloudTime(activeSourceAnimation);
  if (activeModel && activeTime !== null) updateStoryVrPointCloudEffects(activeModel, activeTime);
  for (const entry of activeSupplementalModelEntries) {
    const time = sourcePlaybackPointCloudTime(entry.playback);
    if (time !== null) updateStoryVrPointCloudEffects(entry.model, time);
  }
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  syncSourceCameraViewport(activeSourceAnimation?.sourceCamera);
  renderer.setSize(window.innerWidth, window.innerHeight);
  clampReaderPanelToViewport();
}

function activeRenderCamera() {
  return renderCameraForPlayback(activeSourceAnimation, camera, renderer.xr.isPresenting);
}

function renderCameraForPlayback(playback, readerCamera, xrPresenting) {
  void playback;
  void xrPresenting;
  // The compiled StoryVR reader always renders the authored reader camera.
  // Captured source cameras remain animation evidence, never a replacement for
  // the Spatial Relations pose or live desktop / headset view controls.
  return readerCamera;
}

function syncSourceCameraViewport(sourceCamera) {
  if (!sourceCamera?.isPerspectiveCamera) return;
  sourceCamera.aspect = window.innerWidth / window.innerHeight;
  sourceCamera.updateProjectionMatrix();
}

function modelAssetForBeat(beat) {
  const sharedStates = sourceMotionPlaybackAssets.map((contract) => ({
    contract,
    state: sharedTimelineStateForBeat(contract, beat),
  })).filter((entry) => entry.state);
  const activeSharedState = sharedStates.find((entry) => entry.state.presence === "active");
  const sharedAsset = sourceMotionPlaybackModelAsset(activeSharedState?.contract);
  if (sharedAsset) return sharedAsset;
  const inactiveSharedAssetIds = new Set(sharedStates
    .filter((entry) => entry.state.presence === "inactive")
    .map((entry) => entry.contract.assetId));
  const graphBeat = graphBeats.get(beat.id);
  const linked = [
    ...(Array.isArray(beat.linkedAssets) ? beat.linkedAssets : []),
    ...(Array.isArray(graphBeat?.linkedAssets) ? graphBeat.linkedAssets : []),
  ];
  const models = linked.filter((asset) => isModelAsset(asset) && !inactiveSharedAssetIds.has(asset.id));
  const sourcePartAssetIds = new Set(sourcePartStates.filter((state) => state.beatId === beat.id).map((state) => state.assetId));
  if (sourcePartAssetIds.size) {
    const linkedPartStateModel = models.find((asset) => sourcePartAssetIds.has(asset.id));
    if (linkedPartStateModel) return linkedPartStateModel;
    const runtimePartStateModel = (runtime.assets || []).find((asset) => (
      isModelAsset(asset) && sourcePartAssetIds.has(asset.id) && !inactiveSharedAssetIds.has(asset.id)
    ));
    if (runtimePartStateModel) return runtimePartStateModel;
  }
  const sourceMotionAssetIds = sourceMotionAssetIdsForBeat(beat);
  if (hasSourceMotionLinking && sourceMotionAssetIds.size) {
    const linkedMatch = models.find((asset) => sourceMotionAssetIds.has(asset.id));
    if (linkedMatch) return linkedMatch;
    const runtimeMatch = (runtime.assets || []).find((asset) => (
      isModelAsset(asset) && sourceMotionAssetIds.has(asset.id) && !inactiveSharedAssetIds.has(asset.id)
    ));
    if (runtimeMatch) return runtimeMatch;
  }
  const dynamicAssetIds = new Set(sourceDynamicsLinksForBeat(beat, graphBeat)
    .filter((link) => dynamicGeometryEnabled || link.classification !== "within-beat-dynamics")
    .filter((link) => link.hasEmbeddedAnimation || link.classification)
    .map((link) => link.assetId));
  const spatialAnchorAssetId = spatialTextEntityForBeat(beat)?.anchor?.assetId || null;
  return models.find((asset) => asset.id === spatialAnchorAssetId)
    || models.find((asset) => dynamicAssetIds.has(asset.id))
    || models[0];
}

function sourceMotionModelAssetForBeatChange(fromIndex, toIndex, route = null) {
  if (!hasSourceMotionLinking || fromIndex === toIndex) return null;
  const fromBeat = beats[fromIndex];
  const toBeat = beats[toIndex];
  if (!fromBeat || !toBeat) return null;
  const track = sourceMotionTracks.find((candidate) => (
    candidate.componentId === "inter-beat-dynamics"
    && (candidate.kind === "clip" || candidate.kind === "camera")
    && motionTransitionForBeatChange(candidate.effective.transitions, fromBeat, toBeat, route)
  ));
  if (!track) return null;
  if (sharedTimelineContractForAsset(track.assetId)) return null;
  return (runtime.assets || []).find((asset) => asset.id === track.assetId && isModelAsset(asset)) || null;
}

function isModelAsset(asset) {
  return Boolean(asset?.type === "model" || /\.(glb|gltf)$/i.test(asset?.path || asset?.id || ""));
}

function isImageAsset(asset) {
  const type = String(asset?.type || asset?.mediaType || "").toLowerCase();
  return Boolean(
    ["image", "texture", "photo", "illustration"].some((kind) => type.includes(kind))
    || /\.(avif|gif|jpe?g|png|webp)$/i.test(asset?.path || asset?.id || "")
  );
}

function normalizeSourceMotionPlayback(value) {
  const assets = Array.isArray(value?.assets)
    ? value.assets
    : Array.isArray(value) ? value : [];
  return assets.map((rawAsset) => {
    const mode = String(rawAsset?.mode || rawAsset?.timelineMode || "").toLowerCase();
    const timeline = rawAsset?.timeline && typeof rawAsset.timeline === "object" ? rawAsset.timeline : {};
    const rawBeatStates = Array.isArray(rawAsset?.beatStates)
      ? rawAsset.beatStates
      : Array.isArray(rawAsset?.anchors) ? rawAsset.anchors : [];
    const rawBoundaries = Array.isArray(rawAsset?.boundaries)
      ? rawAsset.boundaries
      : Array.isArray(rawAsset?.segments) ? rawAsset.segments : [];
    const rawCoordinatedClips = Array.isArray(rawAsset?.coordinatedClips)
      ? rawAsset.coordinatedClips
      : Array.isArray(rawAsset?.clips) ? rawAsset.clips : [];
    const defaultLoopMode = String(timeline.defaultLoopMode || "repeat").toLowerCase();
    const coordinatedClips = rawCoordinatedClips.map((item) => {
      const clipIndex = Number(typeof item === "object" ? item?.clipIndex ?? item?.animationIndex ?? item?.index : item);
      if (!Number.isInteger(clipIndex) || clipIndex < 0) return null;
      return {
        ...(typeof item === "object" ? item : {}),
        clipIndex,
        loopMode: String(typeof item === "object" ? item?.loopMode || defaultLoopMode : defaultLoopMode).toLowerCase(),
      };
    }).filter(Boolean);
    const beatStates = rawBeatStates.map((state) => {
      const beatId = String(state?.beatId ?? state?.unitId ?? state?.id ?? "").trim();
      if (!beatId) return null;
      const presence = String(state?.presence || (state?.entryMode === "inactive" ? "inactive" : "active")).toLowerCase();
      const progressValue = state?.localProgress ?? state?.progress;
      const localProgress = presence === "active" && hasExplicitSharedTimelineNumber(progressValue)
        ? normalizedProgress(progressValue, 0)
        : null;
      return {
        ...state,
        beatId,
        presence: presence === "inactive" ? "inactive" : "active",
        localProgress,
        entryMode: String(state?.entryMode || (presence === "inactive" ? "inactive" : "animate")).toLowerCase(),
      };
    }).filter(Boolean);
    const boundaries = rawBoundaries.map((boundary) => {
      const normalized = normalizeMotionTransition(boundary);
      if (!normalized) return null;
      const startValue = boundary?.startProgress ?? boundary?.fromProgress;
      const endValue = boundary?.endProgress ?? boundary?.toProgress;
      return {
        ...boundary,
        ...normalized,
        mode: String(boundary?.mode || boundary?.playbackMode || "scrub").toLowerCase(),
        startProgress: hasExplicitSharedTimelineNumber(startValue) ? normalizedProgress(startValue, 0) : null,
        endProgress: hasExplicitSharedTimelineNumber(endValue) ? normalizedProgress(endValue, 1) : null,
        contributorClipIndexes: uniqueIntegers(boundary?.contributorClipIndexes || boundary?.clipIndexes || []),
      };
    }).filter(Boolean);
    const rawCamera = rawAsset?.camera && typeof rawAsset.camera === "object" ? rawAsset.camera : null;
    const rawCameraIndex = rawCamera?.cameraIndex;
    const camera = rawCamera ? {
      ...rawCamera,
      cameraIndex: hasExplicitSharedTimelineNumber(rawCameraIndex) && Number.isInteger(Number(rawCameraIndex))
        ? Number(rawCameraIndex)
        : null,
      clipIndexes: uniqueIntegers(rawCamera.clipIndexes || []),
      desktopPolicy: String(rawCamera.desktopPolicy || "render-source-camera").toLowerCase(),
      xrPolicy: String(rawCamera.xrPolicy || "preserve-viewer-camera").toLowerCase(),
    } : null;
    return {
      ...rawAsset,
      assetId: String(rawAsset?.assetId || rawAsset?.id || ""),
      mode,
      timeline: {
        ...timeline,
        durationSeconds: Number.isFinite(Number(timeline.durationSeconds ?? rawAsset?.durationSeconds))
          ? Math.max(0, Number(timeline.durationSeconds ?? rawAsset.durationSeconds))
          : null,
        timeMapping: String(timeline.timeMapping || "shared-absolute").toLowerCase(),
        defaultLoopMode,
      },
      coordinatedClips,
      beatStates,
      boundaries,
      camera,
      materials: Array.isArray(rawAsset?.materials) ? rawAsset.materials : [],
      bindings: Array.isArray(rawAsset?.bindings) ? rawAsset.bindings : [],
      annotations: Array.isArray(rawAsset?.annotations) ? rawAsset.annotations : [],
    };
  }).filter((asset) => asset.assetId && asset.mode === "shared-timeline");
}

function sharedTimelineStateForBeat(contract, beat) {
  if (!contract || !beat) return null;
  const ids = beatIdentitySet(beat);
  return (contract.beatStates || []).find((state) => ids.has(state.beatId)) || null;
}

function reverseSharedTimelineBoundaryMode(mode) {
  const normalized = String(mode || "none").toLowerCase();
  if (normalized === "initialize") return "clear";
  if (normalized === "clear") return "initialize";
  if (normalized === "scrub" || normalized === "hold") return normalized;
  return "none";
}

function sharedTimelineBoundaryForBeatChange(contract, fromBeat, toBeat, route = null) {
  if (!contract || !fromBeat || !toBeat) return null;
  const forward = motionTransitionForBeatChange(contract.boundaries, fromBeat, toBeat, route);
  if (forward) return { ...forward, reverse: false };
  const reverse = motionTransitionForBeatChange(contract.boundaries, toBeat, fromBeat, route);
  if (!reverse) return null;
  return {
    ...reverse,
    fromBeatId: reverse.toBeatId,
    toBeatId: reverse.fromBeatId,
    mode: reverseSharedTimelineBoundaryMode(reverse.mode),
    startProgress: reverse.endProgress,
    endProgress: reverse.startProgress,
    reverse: true,
  };
}

function resolveSharedTimelineBeatChange(contract, fromBeat, toBeat, options = {}) {
  if (!contract || contract.mode !== "shared-timeline" || !toBeat) return null;
  const fromState = sharedTimelineStateForBeat(contract, fromBeat);
  const toState = sharedTimelineStateForBeat(contract, toBeat);
  const boundary = sharedTimelineBoundaryForBeatChange(contract, fromBeat, toBeat, options.route);
  if (!boundary && !options.initial) return null;
  if (!fromState && !toState && !boundary) return null;

  const fromPresence = options.initial
    ? "inactive"
    : fromState?.presence || (boundary?.mode === "scrub" || boundary?.mode === "hold" ? "active" : "inactive");
  const toPresence = toState?.presence || (boundary?.mode === "initialize" || boundary?.mode === "scrub" || boundary?.mode === "hold"
    ? "active"
    : "inactive");
  const stateStart = fromState?.localProgress;
  const stateEnd = toState?.localProgress;
  const startProgress = hasExplicitSharedTimelineNumber(boundary?.startProgress)
    ? normalizedProgress(boundary.startProgress, stateStart ?? 0)
    : normalizedProgress(stateStart, 0);
  const endProgress = hasExplicitSharedTimelineNumber(boundary?.endProgress)
    ? normalizedProgress(boundary.endProgress, stateEnd ?? startProgress)
    : normalizedProgress(stateEnd, startProgress);

  const declaredMode = String(boundary?.mode || "none").toLowerCase();
  const mode = options.initial
    ? (toPresence === "active" ? "initialize" : "none")
    : ["initialize", "scrub", "hold", "clear"].includes(declaredMode) ? declaredMode : "none";

  const seekProgress = mode === "hold" || mode === "initialize" ? endProgress : null;
  return {
    sourceMotion: true,
    sharedTimeline: true,
    contract,
    assetId: contract.assetId,
    fromBeatId: fromBeat?.id || boundary?.fromBeatId || "",
    toBeatId: toBeat.id || boundary?.toBeatId || "",
    fromState,
    toState,
    fromPresence,
    toPresence,
    boundary,
    mode,
    startProgress: mode === "initialize" ? endProgress : startProgress,
    endProgress,
    seekProgress,
    reverse: Boolean(boundary?.reverse),
  };
}

function sharedTimelinePlaybackForBeatChange(contracts, fromBeat, toBeat, options = {}) {
  let clearFallback = null;
  for (const contract of contracts || []) {
    const resolved = resolveSharedTimelineBeatChange(contract, fromBeat, toBeat, options);
    if (!resolved || resolved.mode === "none") continue;
    if (resolved.mode === "clear") {
      if (!clearFallback) clearFallback = resolved;
      continue;
    }
    return resolved;
  }
  return clearFallback;
}

function sourceMotionSharedPlaybackForBeatChange(fromIndex, toIndex, options = {}) {
  const fromBeat = beats[fromIndex] || null;
  const toBeat = beats[toIndex] || null;
  return sharedTimelinePlaybackForBeatChange(sourceMotionPlaybackAssets, fromBeat, toBeat, options);
}

function sourceMotionPlaybackModelAsset(contract) {
  if (!contract?.assetId) return null;
  return (runtime.assets || []).find((asset) => asset.id === contract.assetId && isModelAsset(asset)) || null;
}

function sharedTimelineContractForAsset(assetId) {
  const id = String(assetId || "").trim();
  return id ? sourceMotionPlaybackAssets.find((contract) => contract.assetId === id) || null : null;
}

function staticSharedTimelinePlaybackForBeat(contract, beat) {
  const state = sharedTimelineStateForBeat(contract, beat);
  if (!state || state.presence !== "active" || !hasExplicitSharedTimelineNumber(state.localProgress)) return null;
  const progress = normalizedProgress(state.localProgress, 0);
  return {
    sourceMotion: true,
    sharedTimeline: true,
    contract,
    assetId: contract.assetId,
    fromBeatId: beat?.id || state.beatId,
    toBeatId: beat?.id || state.beatId,
    fromState: state,
    toState: state,
    fromPresence: "active",
    toPresence: "active",
    boundary: null,
    mode: "hold",
    startProgress: progress,
    endProgress: progress,
    seekProgress: progress,
    reverse: false,
    diagnostic: "No exact shared-timeline boundary; holding the destination contract state",
  };
}

function normalizeSourceMotionTracks(linking) {
  if (!linking || typeof linking !== "object") return [];
  const tracks = Array.isArray(linking.tracks) ? linking.tracks : [];
  const assignments = Array.isArray(linking.assignments) ? linking.assignments : [];
  return tracks.map((rawTrack, index) => {
    const id = String(rawTrack?.id || rawTrack?.trackId || `source-motion-track-${index}`);
    const matchingAssignments = assignments.filter((assignment) => String(assignment?.trackId || assignment?.id || "") === id);
    const beatAssignmentPresent = matchingAssignments.some((assignment) => (
      Object.hasOwn(assignment || {}, "beatIds") || Object.hasOwn(assignment?.effective || {}, "beatIds")
    ));
    const transitionAssignmentPresent = matchingAssignments.some((assignment) => (
      Object.hasOwn(assignment || {}, "transitions") || Object.hasOwn(assignment?.effective || {}, "transitions")
    ));
    const inferredBeatIds = rawTrack?.effective?.beatIds ?? rawTrack?.beatIds ?? [];
    const inferredTransitions = rawTrack?.effective?.transitions ?? rawTrack?.transitions ?? [];
    const assignedBeatIds = matchingAssignments.flatMap((assignment) => (
      assignment?.beatIds ?? assignment?.effective?.beatIds ?? []
    ));
    const assignedTransitions = matchingAssignments.flatMap((assignment) => (
      assignment?.transitions ?? assignment?.effective?.transitions ?? []
    ));
    const assignment = matchingAssignments.at(-1) || {};
    return {
      ...rawTrack,
      id,
      trackId: id,
      assetId: String(assignment.assetId || rawTrack?.assetId || ""),
      componentId: String(assignment.componentId || rawTrack?.componentId || ""),
      kind: String(assignment.kind || rawTrack?.kind || "clip").toLowerCase(),
      effective: {
        beatIds: uniqueStrings(beatAssignmentPresent ? assignedBeatIds : inferredBeatIds),
        transitions: uniqueMotionTransitions(transitionAssignmentPresent ? assignedTransitions : inferredTransitions),
      },
    };
  }).filter((track) => track.assetId);
}

function sourceMotionTrackAppliesToComponent(track, componentId) {
  const applicable = uniqueStrings(track?.applicableComponents || []);
  return applicable.length ? applicable.includes(componentId) : track?.componentId === componentId;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function uniqueIntegers(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0))];
}

function uniqueMotionTransitions(values) {
  const transitions = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const transition = normalizeMotionTransition(value);
    if (!transition) continue;
    const key = runtimeProgressionRouteIsScoped(transition)
      ? runtimeProgressionRouteKey(transition)
      : `${transition.fromBeatId}->${transition.toBeatId}`;
    transitions.set(key, transition);
  }
  return [...transitions.values()];
}

function normalizeMotionTransition(value) {
  if (typeof value === "string") {
    const [fromBeatId, toBeatId] = value.split(/\s*->\s*/, 2).map((part) => part?.trim());
    return fromBeatId && toBeatId ? { fromBeatId, toBeatId } : null;
  }
  if (!value || typeof value !== "object") return null;
  const fromBeatId = String(
    value.fromBeatId ?? value.fromUnitId ?? value.fromId ?? value.fromContext?.beatId ?? value.from?.beatId ?? value.from?.id ?? value.from ?? "",
  ).trim();
  const toBeatId = String(
    value.toBeatId ?? value.toUnitId ?? value.toId ?? value.toContext?.beatId ?? value.to?.beatId ?? value.to?.id ?? value.to ?? "",
  ).trim();
  if (!fromBeatId || !toBeatId) return null;
  return { ...value, fromBeatId, toBeatId };
}

function beatIdentitySet(beat) {
  return new Set(uniqueStrings([beat?.id, ...(Array.isArray(beat?.atomicBeatIds) ? beat.atomicBeatIds : [])]));
}

function sourceMotionAssetIdsForBeat(beat) {
  const ids = new Set();
  if (!hasSourceMotionLinking || !beat) return ids;
  const beatIds = beatIdentitySet(beat);
  for (const track of sourceMotionTracks) {
    const assignedToBeat = track.kind === "clip"
      && sourceMotionTrackAppliesToComponent(track, "dynamic-geometry")
      && track.effective.beatIds.some((beatId) => beatIds.has(beatId));
    const assignedToTransition = sourceMotionTrackAppliesToComponent(track, "inter-beat-dynamics")
      && track.effective.transitions.some((transition) => (
        beatIds.has(transition.fromBeatId) || beatIds.has(transition.toBeatId)
      ));
    if (assignedToBeat || assignedToTransition) ids.add(track.assetId);
  }
  return ids;
}

function sourceMotionTracksForBeat(assetId, beat) {
  if (!hasSourceMotionLinking || !dynamicGeometryEnabled) return [];
  const beatIds = beatIdentitySet(beat);
  return sourceMotionTracks.filter((track) => (
    track.assetId === assetId
    && track.kind === "clip"
    && sourceMotionTrackAppliesToComponent(track, "dynamic-geometry")
    && track.effective.beatIds.some((beatId) => beatIds.has(beatId))
  ));
}

function sourceTransitionForBeatChange(fromIndex, toIndex, assetId, route = null) {
  if (!hasSourceMotionLinking) return transitionSegmentForBeatChange(fromIndex, toIndex, assetId);
  if (fromIndex === toIndex) return null;
  const fromBeat = beats[fromIndex];
  const toBeat = beats[toIndex];
  if (!fromBeat || !toBeat) return null;
  const matches = [];
  for (const track of sourceMotionTracks) {
    if (track.assetId !== assetId || !sourceMotionTrackAppliesToComponent(track, "inter-beat-dynamics")) continue;
    if (track.kind !== "clip" && track.kind !== "camera") continue;
    const transition = motionTransitionForBeatChange(track.effective.transitions, fromBeat, toBeat, route);
    if (transition) matches.push({ track, transition });
  }
  if (!matches.length) return null;
  return {
    sourceMotion: true,
    fromBeatId: fromBeat.id,
    toBeatId: toBeat.id,
    ...(route ? { route: normalizeRuntimeProgressionRoute(route) } : {}),
    matches,
    compatibilitySegment: transitionSegmentForBeatChange(fromIndex, toIndex, assetId),
  };
}

function motionTransitionForBeatChange(transitions, fromBeat, toBeat, route = null) {
  const candidates = Array.isArray(transitions) ? transitions : [];
  if (route) {
    const exact = candidates.find((transition) => motionTransitionMatches(transition, fromBeat, toBeat, route));
    if (exact) return exact;
  }
  return candidates.find((transition) => motionTransitionMatches(transition, fromBeat, toBeat)) || null;
}

function motionTransitionMatches(transition, fromBeat, toBeat, route = null) {
  const fromIds = beatIdentitySet(fromBeat);
  const toIds = beatIdentitySet(toBeat);
  if (!fromIds.has(transition.fromBeatId) || !toIds.has(transition.toBeatId)) return false;
  if (!route) return !runtimeProgressionRouteIsScoped(transition);
  return runtimeProgressionRoutesMatch(transition, route);
}

function sharedTimelineCoordinatedClipEntries(contract, clips) {
  const availableClips = Array.isArray(clips) ? clips : [];
  const defaultLoopMode = String(contract?.timeline?.defaultLoopMode || "repeat").toLowerCase();
  const byIndex = new Map();
  for (const item of contract?.coordinatedClips || []) {
    const clipIndex = Number(item?.clipIndex);
    if (!Number.isInteger(clipIndex) || clipIndex < 0 || clipIndex >= availableClips.length) continue;
    byIndex.set(clipIndex, {
      clipIndex,
      clip: availableClips[clipIndex],
      loopMode: String(item?.loopMode || defaultLoopMode).toLowerCase(),
    });
  }
  for (const clipIndex of uniqueIntegers(contract?.camera?.clipIndexes || [])) {
    if (clipIndex >= availableClips.length || byIndex.has(clipIndex)) continue;
    byIndex.set(clipIndex, {
      clipIndex,
      clip: availableClips[clipIndex],
      loopMode: defaultLoopMode,
    });
  }
  return [...byIndex.values()].sort((left, right) => left.clipIndex - right.clipIndex);
}

function sharedTimelineMasterDuration(contract, clipEntries) {
  const declared = Number(contract?.timeline?.durationSeconds);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return Math.max(0, ...(clipEntries || []).map((entry) => Number(entry?.clip?.duration) || 0));
}

function sharedTimelineTimeSeconds(durationSeconds, progress) {
  const duration = Number.isFinite(Number(durationSeconds)) ? Math.max(0, Number(durationSeconds)) : 0;
  return duration * normalizedProgress(progress, 0);
}

function configureSharedTimelineAction(action, loopMode) {
  const mode = String(loopMode || "repeat").toLowerCase();
  action.reset();
  if (mode === "repeat") action.setLoop(THREE.LoopRepeat, Infinity);
  else if (mode === "ping-pong" || mode === "pingpong") action.setLoop(THREE.LoopPingPong, Infinity);
  else {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = mode === "clamp" || mode === "once";
  }
  action.play();
}

function createSharedTimelinePlayback(root, clips, sourceCameras, transitionPlayback) {
  if (!root || !transitionPlayback?.contract || transitionPlayback.toPresence !== "active") return null;
  const contract = transitionPlayback.contract;
  const materialState = initializeSharedTimelineMaterials(root, contract.materials || []);
  prepareSharedTimelineBindingState(root);
  const mixer = new THREE.AnimationMixer(root);
  const clipEntries = sharedTimelineCoordinatedClipEntries(contract, clips);
  const actionEntries = clipEntries.map((entry) => ({
    ...entry,
    action: mixer.clipAction(entry.clip),
  }));
  for (const entry of actionEntries) configureSharedTimelineAction(entry.action, entry.loopMode);
  const timelineDurationSeconds = sharedTimelineMasterDuration(contract, clipEntries);
  const sourceCamera = sharedTimelineSourceCamera(sourceCameras, contract.camera);
  syncSourceCameraViewport(sourceCamera);
  const startProgress = normalizedProgress(transitionPlayback.startProgress, transitionPlayback.endProgress ?? 0);
  const endProgress = normalizedProgress(transitionPlayback.endProgress, startProgress);
  const clipSpanSeconds = timelineDurationSeconds * Math.abs(endProgress - startProgress);
  const annotations = (contract.annotations || []).filter(sharedTimelineAnnotationIsReaderVisible);
  const playback = {
    mixer,
    root,
    actions: actionEntries.map((entry) => entry.action),
    actionEntries,
    clips: clipEntries.map((entry) => entry.clip),
    mode: transitionPlayback.mode === "scrub" ? "segment" : "frozen",
    boundaryMode: transitionPlayback.mode,
    segment: { startProgress, endProgress },
    elapsed: 0,
    transitionStartedAtMs: transitionPlayback.mode === "scrub" ? performance.now() : null,
    durationSeconds: Math.max(0.9, Math.min(2.4, clipSpanSeconds || 1.2)),
    timelineDurationSeconds,
    currentProgress: startProgress,
    sourceMotion: true,
    sharedTimeline: true,
    trackIds: [],
    contract,
    materialRecipes: materialState.recipes,
    bindings: contract.bindings || [],
    annotations,
    wallClockBindings: (contract.bindings || []).filter(sharedTimelineBindingUsesWallClock),
    wallClockAnnotations: annotations.filter((annotation) => sharedTimelineBindingUsesWallClock({
      source: annotation?.opacitySource,
    })),
    annotationTargets: new Map(),
    annotationElements: [],
    notice: transitionPlayback.diagnostic ? String(transitionPlayback.diagnostic) : "",
    diagnostics: [...materialState.diagnostics],
    clockSeconds: 0,
    sourceCamera,
    initialSourceCameraFocalLength: Number(sourceCamera?.getFocalLength?.()),
    cameraPolicy: contract.camera || null,
    cameraUnavailable: Number.isInteger(contract.camera?.cameraIndex) && !sourceCamera,
  };
  initializeSharedTimelineAnnotations(playback);
  seekSharedTimelinePlayback(
    playback,
    transitionPlayback.mode === "scrub" ? startProgress : endProgress,
  );
  return playback;
}

function seekSharedTimelinePlayback(playback, progress) {
  if (!playback?.mixer) return;
  const normalized = normalizedProgress(progress, playback.currentProgress ?? 0);
  playback.currentProgress = normalized;
  playback.mixer.setTime(sharedTimelineTimeSeconds(playback.timelineDurationSeconds, normalized));
  applySharedTimelineBindings(playback, normalized);
}

function createSourceAnimationPlayback(root, clips, sourceCameras, asset, beat, transitionPlayback = null) {
  if (!root) return null;
  const sharedContract = sharedTimelineContractForAsset(asset?.id);
  if (sharedContract) {
    const staticPlayback = staticSharedTimelinePlaybackForBeat(sharedContract, beat);
    return staticPlayback ? createSharedTimelinePlayback(root, clips, sourceCameras, staticPlayback) : null;
  }
  if (hasSourceMotionLinking) {
    return createLinkedSourceMotionPlayback(root, clips, sourceCameras, asset, beat, transitionPlayback);
  }
  return createLegacySourceAnimationPlayback(root, clips, asset, beat, transitionPlayback);
}

function createLinkedSourceMotionPlayback(root, clips, sourceCameras, asset, beat, transitionPlayback) {
  const availableClips = Array.isArray(clips) ? clips : [];
  const mixer = new THREE.AnimationMixer(root);
  if (transitionPlayback?.sourceMotion) {
    const actionEntries = sourceMotionActionEntries(mixer, availableClips, transitionPlayback.matches, transitionPlayback.compatibilitySegment);
    const cameraMatch = transitionPlayback.matches.find(({ track }) => track.kind === "camera");
    const sourceCamera = cameraMatch ? sourceCameraForTrack(sourceCameras, cameraMatch.track) : null;
    if (!actionEntries.length && !sourceCamera) return null;
    for (const entry of actionEntries) {
      entry.action.reset();
      entry.action.setLoop(THREE.LoopOnce, 1);
      entry.action.clampWhenFinished = true;
      entry.action.play();
    }
    syncSourceCameraViewport(sourceCamera);
    const clipSpanSeconds = Math.max(0, ...actionEntries.map((entry) => (
      (Number(entry.clip.duration) || 0) * Math.abs(entry.endProgress - entry.startProgress)
    )));
    const representativeSegment = actionEntries.find((entry) => entry.timingExplicit)
      || transitionPlayback.compatibilitySegment
      || actionEntries[0]
      || { startProgress: 0, endProgress: 1 };
    const playback = {
      mixer,
      actions: actionEntries.map((entry) => entry.action),
      actionEntries,
      clips: actionEntries.map((entry) => entry.clip),
      mode: "segment",
      segment: {
        startProgress: normalizedProgress(representativeSegment.startProgress, 0),
        endProgress: normalizedProgress(representativeSegment.endProgress, 1),
      },
      elapsed: 0,
      transitionStartedAtMs: performance.now(),
      durationSeconds: Math.max(0.9, Math.min(2.4, clipSpanSeconds || 1.2)),
      sourceMotion: true,
      trackIds: transitionPlayback.matches.map(({ track }) => track.id),
      sourceCamera,
      cameraTrackId: cameraMatch?.track.id || null,
      cameraUnavailable: Boolean(cameraMatch && !sourceCamera),
    };
    applySourceAnimationSegment(playback, 0);
    return playback;
  }

  const tracks = sourceMotionTracksForBeat(asset.id, beat);
  const actionEntries = sourceMotionActionEntries(mixer, availableClips, tracks.map((track) => ({ track, transition: null })), null);
  if (!actionEntries.length) return null;
  for (const entry of actionEntries) {
    entry.action.reset();
    entry.action.setLoop(THREE.LoopRepeat, Infinity);
    entry.action.play();
  }
  return {
    mixer,
    actions: actionEntries.map((entry) => entry.action),
    actionEntries,
    clips: actionEntries.map((entry) => entry.clip),
    mode: "loop",
    segment: null,
    sourceMotion: true,
    trackIds: tracks.map((track) => track.id),
    sourceCamera: null,
  };
}

function sourceMotionActionEntries(mixer, clips, matches, compatibilitySegment) {
  const byClipIndex = new Map();
  for (const { track, transition } of matches || []) {
    const timing = sourceMotionTiming(transition, track, compatibilitySegment);
    for (const clipIndex of clipIndexesForTrack(track, clips)) {
      const clip = clips[clipIndex];
      if (!clip) continue;
      const entry = {
        clipIndex,
        clip,
        action: mixer.clipAction(clip),
        startProgress: timing.startProgress,
        endProgress: timing.endProgress,
        timingExplicit: timing.explicit,
        trackIds: [track.id],
      };
      if (byClipIndex.has(clipIndex)) {
        const existing = byClipIndex.get(clipIndex);
        existing.trackIds = uniqueStrings([...existing.trackIds, track.id]);
        if (timing.explicit) {
          existing.startProgress = timing.startProgress;
          existing.endProgress = timing.endProgress;
          existing.timingExplicit = true;
        }
      } else {
        byClipIndex.set(clipIndex, entry);
      }
    }
  }
  return [...byClipIndex.values()];
}

function clipIndexesForTrack(track, clips) {
  const explicit = [
    ...(Array.isArray(track?.clipIndexes) ? track.clipIndexes : []),
    ...(track?.clipIndex === undefined || track?.clipIndex === null ? [] : [track.clipIndex]),
  ].map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < clips.length);
  if (explicit.length) return [...new Set(explicit)];
  const animationName = String(track?.animationName || "");
  if (!animationName) return [];
  return clips.flatMap((clip, index) => clip?.name === animationName ? [index] : []);
}

function sourceMotionTiming(transition, track, compatibilitySegment) {
  const explicitStart = transition?.startProgress ?? track?.startProgress;
  const explicitEnd = transition?.endProgress ?? track?.endProgress;
  const explicit = Number.isFinite(Number(explicitStart)) || Number.isFinite(Number(explicitEnd));
  return {
    startProgress: normalizedProgress(explicitStart, compatibilitySegment?.startProgress ?? 0),
    endProgress: normalizedProgress(explicitEnd, compatibilitySegment?.endProgress ?? 1),
    explicit,
  };
}

function hasExplicitSharedTimelineNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function normalizedProgress(value, fallback) {
  const number = hasExplicitSharedTimelineNumber(value) ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) {
    const fallbackNumber = hasExplicitSharedTimelineNumber(fallback) ? Number(fallback) : 0;
    return Math.max(0, Math.min(1, fallbackNumber));
  }
  return Math.max(0, Math.min(1, number));
}

function sharedTimelineBindingNode(root, reference) {
  if (!root || !reference) return null;
  const descriptor = typeof reference === "string" ? { node: reference } : reference;
  const requested = String(descriptor?.node || descriptor?.nodeName || descriptor?.name || descriptor?.path || "").trim();
  if (!requested) return null;
  const direct = root.getObjectByName?.(requested);
  if (direct) return direct;
  let match = null;
  root.traverse?.((node) => {
    if (match) return;
    const names = [];
    let current = node;
    while (current && current !== root) {
      if (current.name) names.unshift(current.name);
      current = current.parent;
    }
    const path = names.join("/");
    if (node?.name === requested || path === requested || path.endsWith(`/${requested}`)) match = node;
  });
  return match;
}

function sharedTimelinePropertyValue(target, property) {
  if (!target) return Number.NaN;
  const path = String(property || "").split(".").map((part) => part.trim()).filter(Boolean);
  let value = target;
  for (const part of path) value = value?.[part];
  return hasExplicitSharedTimelineNumber(value) ? Number(value) : Number.NaN;
}

function sharedTimelineBindingValue(playback, binding, progress) {
  const source = binding?.source && typeof binding.source === "object" ? binding.source : {};
  const sourceType = String(source.type || binding?.sourceType || "").toLowerCase().replace(/_/g, "-");
  if (sourceType === "timeline-progress") return progress;
  if (sourceType === "timeline-time") return sharedTimelineTimeSeconds(playback?.timelineDurationSeconds, progress);
  if (sourceType === "wall-clock-time") return Number(playback?.clockSeconds) || 0;
  if (sourceType === "constant") return Number(source.value ?? binding?.value);
  if (hasExplicitSharedTimelineNumber(binding?.value)) return Number(binding.value);
  const sourceNode = sharedTimelineBindingNode(playback?.root, {
    node: source.node || source.nodeName || binding?.sourceNode,
    path: source.node || source.nodeName || binding?.sourceNode ? "" : source.path,
  });
  const property = source.property
    || source.pathProperty
    || binding?.sourceProperty
    || (source.node || source.nodeName || binding?.sourceNode ? source.path : "")
    || "";
  return sharedTimelinePropertyValue(sourceNode, property);
}

function sharedTimelineBindingParameters(binding) {
  return binding?.parameters && typeof binding.parameters === "object"
    ? binding.parameters
    : binding?.options && typeof binding.options === "object" ? binding.options : {};
}

function transformedSharedTimelineBindingValue(value, binding) {
  if (!hasExplicitSharedTimelineNumber(value)) return Number.NaN;
  const parameters = sharedTimelineBindingParameters(binding);
  const source = binding?.source && typeof binding.source === "object" ? binding.source : {};
  const multiplier = finiteSharedTimelineNumber(
    parameters.multiplier,
    parameters.scale,
    binding?.multiplier,
    binding?.factor,
    source.multiplier,
    1,
  );
  const offset = finiteSharedTimelineNumber(parameters.offset, binding?.offset, source.offset, 0);
  let transformed = Number(value) * multiplier + offset;
  if (parameters.invert === true || binding?.invert === true || source.invert === true) transformed = 1 - transformed;
  const range = Array.isArray(parameters.clamp)
    ? parameters.clamp
    : Array.isArray(binding?.clamp) ? binding.clamp : Array.isArray(source.clamp) ? source.clamp : [];
  const minimum = finiteSharedTimelineNumber(
    parameters.minimum,
    parameters.min,
    binding?.minimum,
    binding?.min,
    range[0],
  );
  const maximum = finiteSharedTimelineNumber(
    parameters.maximum,
    parameters.max,
    binding?.maximum,
    binding?.max,
    range[1],
  );
  if (minimum != null) transformed = Math.max(minimum, transformed);
  if (maximum != null) transformed = Math.min(maximum, transformed);
  return transformed;
}

function addSharedTimelineDiagnostic(playback, message) {
  if (!playback || !message) return;
  if (!Array.isArray(playback.diagnostics)) playback.diagnostics = [];
  if (!playback.diagnostics.includes(message)) playback.diagnostics.push(message);
}

function sharedTimelineBindingTarget(playback, binding) {
  const target = binding?.target && typeof binding.target === "object" ? binding.target : {};
  return sharedTimelineBindingNode(playback?.root, {
    node: target.node || target.nodeName || binding?.targetNode,
    path: target.path,
  });
}

function forEachSharedTimelineMaterial(node, callback) {
  const materials = Array.isArray(node?.material) ? node.material : node?.material ? [node.material] : [];
  for (const material of materials) callback(material);
}

function finiteSharedTimelineNumber(...values) {
  for (const value of values) {
    if (hasExplicitSharedTimelineNumber(value)) return Number(value);
  }
  return null;
}

function sharedTimelineMaterialRecipeName(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function sharedTimelineMaterialSide(value, fallback = THREE.FrontSide) {
  const side = String(value || "").trim().toLowerCase();
  if (["double", "double-side", "double-sided"].includes(side)) return THREE.DoubleSide;
  if (["back", "back-side", "back-sided"].includes(side)) return THREE.BackSide;
  if (["front", "front-side", "front-sided"].includes(side)) return THREE.FrontSide;
  return fallback;
}

function sharedTimelineMaterialBlending(value, fallback = THREE.NormalBlending) {
  const blending = String(value || "").trim().toLowerCase();
  if (blending === "additive") return THREE.AdditiveBlending;
  if (blending === "multiply") return THREE.MultiplyBlending;
  if (blending === "subtractive") return THREE.SubtractiveBlending;
  if (blending === "normal") return THREE.NormalBlending;
  return fallback;
}

function sharedTimelineDataChannel(value) {
  const channel = String(value || "r").trim().toLowerCase();
  if (channel === "g" || channel === "green") return new THREE.Vector4(0, 1, 0, 0);
  if (channel === "b" || channel === "blue") return new THREE.Vector4(0, 0, 1, 0);
  if (channel === "a" || channel === "alpha") return new THREE.Vector4(0, 0, 0, 1);
  return new THREE.Vector4(1, 0, 0, 0);
}

function sharedTimelineAtlasOffset(value) {
  if (Array.isArray(value)) {
    return new THREE.Vector2(
      finiteSharedTimelineNumber(value[0], 0) ?? 0,
      finiteSharedTimelineNumber(value[1], 0) ?? 0,
    );
  }
  if (value && typeof value === "object") {
    return new THREE.Vector2(
      finiteSharedTimelineNumber(value.x, value.u, 0) ?? 0,
      finiteSharedTimelineNumber(value.y, value.v, 0) ?? 0,
    );
  }
  return new THREE.Vector2(0, 0);
}

function sharedTimelineScalarFieldColor(value) {
  if (Array.isArray(value) && value.length >= 3) {
    const components = value.slice(0, 3).map((component) => Number(component));
    if (components.every(Number.isFinite)) return components;
  }
  if (value && typeof value === "object") {
    const components = [value.r, value.g, value.b].map((component) => Number(component));
    if (components.every(Number.isFinite)) return components;
  }
  try {
    const color = new THREE.Color(value);
    return [color.r, color.g, color.b];
  } catch {
    return null;
  }
}

function sharedTimelineScalarFieldColorRamp(value) {
  const declared = Array.isArray(value) ? value : [];
  const stops = declared.flatMap((entry) => {
    const stop = Array.isArray(entry)
      ? finiteSharedTimelineNumber(entry[0])
      : finiteSharedTimelineNumber(entry?.stop, entry?.position);
    const colorValue = Array.isArray(entry) ? entry[1] : entry?.color;
    const color = colorValue == null ? null : sharedTimelineScalarFieldColor(colorValue);
    return stop == null || !color ? [] : [{ stop: Math.max(0, Math.min(1, stop)), color }];
  }).sort((left, right) => left.stop - right.stop);
  const uniqueStops = [];
  for (const stop of stops) {
    const existing = uniqueStops.findIndex((item) => item.stop === stop.stop);
    if (existing >= 0) uniqueStops[existing] = stop;
    else uniqueStops.push(stop);
  }
  return uniqueStops.length >= 2
    ? uniqueStops
    : [{ stop: 0, color: [0, 0, 0] }, { stop: 1, color: [1, 1, 1] }];
}

function sharedTimelineShaderNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0.0";
  return Number.isInteger(number) ? `${number}.0` : String(number);
}

function sharedTimelineScalarFieldColorShader(value) {
  const stops = sharedTimelineScalarFieldColorRamp(value);
  const colorLiteral = (color) => `vec3(${color.map(sharedTimelineShaderNumber).join(", ")})`;
  const lines = [
    "value = clamp(value, 0.0, 1.0);",
    `vec3 color = ${colorLiteral(stops[0].color)};`,
  ];
  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const current = stops[index];
    lines.push(
      `color = mix(color, ${colorLiteral(current.color)}, ramp(${sharedTimelineShaderNumber(previous.stop)}, ${sharedTimelineShaderNumber(current.stop)}, value));`,
    );
  }
  lines.push("return color;");
  return `vec3 scalarFieldColor(float value) { ${lines.join(" ")} }`;
}

function createSharedTimelineMaterial(definition, originalMaterial) {
  const recipe = sharedTimelineMaterialRecipeName(definition?.recipe || definition?.type);
  const parameters = definition?.parameters && typeof definition.parameters === "object" ? definition.parameters : {};
  const commonUniforms = {
    showAmt: { value: finiteSharedTimelineNumber(parameters.showAmt, 1) ?? 1 },
    storyvrOpacity: { value: 1 },
  };
  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  let material = null;
  if (recipe === "uv-stripe-flow") {
    material = new THREE.ShaderMaterial({
      uniforms: {
        ...commonUniforms,
        time: { value: finiteSharedTimelineNumber(parameters.time, 0) ?? 0 },
        color: { value: new THREE.Color(parameters.color || "#40b5b5") },
        maxAlpha: { value: finiteSharedTimelineNumber(parameters.maxAlpha, 0.5) ?? 0.5 },
        speed: { value: finiteSharedTimelineNumber(parameters.speed, 0.08) ?? 0.08 },
        density: { value: finiteSharedTimelineNumber(parameters.density, 0.2) ?? 0.2 },
        gap: { value: finiteSharedTimelineNumber(parameters.gap, 0.35) ?? 0.35 },
        timeScale: { value: finiteSharedTimelineNumber(parameters.timeScale, 0.6) ?? 0.6 },
      },
      vertexShader,
      fragmentShader: `
        uniform float time;
        uniform float showAmt;
        uniform float storyvrOpacity;
        uniform vec3 color;
        uniform float maxAlpha;
        uniform float speed;
        uniform float density;
        uniform float gap;
        uniform float timeScale;
        varying vec2 vUv;
        void main() {
          const float PI = 3.14159265359;
          float x = vUv.x * density * 500.0 - time * timeScale * speed;
          float intensity = fract(x / PI);
          intensity = smoothstep(gap, 1.0, intensity);
          gl_FragColor = vec4(color, min(intensity, maxAlpha) * showAmt * storyvrOpacity);
        }
      `,
    });
  } else if (recipe === "texture-background-fade") {
    const map = originalMaterial?.map || null;
    if (!map) return null;
    const backgroundColor = sharedTimelineScalarFieldColor(parameters.backgroundColor) || [0.91, 0.92, 0.93];
    material = new THREE.ShaderMaterial({
      uniforms: {
        ...commonUniforms,
        map: { value: map },
        backgroundColor: { value: new THREE.Color().setRGB(...backgroundColor) },
        fadeOpacity: { value: finiteSharedTimelineNumber(parameters.fadeOpacity, 1) ?? 1 },
      },
      vertexShader,
      fragmentShader: `
        uniform sampler2D map;
        uniform vec3 backgroundColor;
        uniform float fadeOpacity;
        uniform float showAmt;
        uniform float storyvrOpacity;
        varying vec2 vUv;
        void main() {
          float fade = clamp(fadeOpacity, 0.0, 1.0);
          vec3 textureColor = texture2D(map, vUv).rgb;
          gl_FragColor = vec4(
            mix(backgroundColor, textureColor, fade),
            fade * showAmt * storyvrOpacity
          );
        }
      `,
    });
  } else if (recipe === "texture-atlas-scalar-field") {
    const map = originalMaterial?.map || null;
    if (!map) return null;
    if ("colorSpace" in map) map.colorSpace = THREE.NoColorSpace;
    material = new THREE.ShaderMaterial({
      uniforms: {
        ...commonUniforms,
        map: { value: map },
        progress: { value: finiteSharedTimelineNumber(parameters.progress, 0) ?? 0 },
        frameCount: { value: Math.max(2, finiteSharedTimelineNumber(parameters.frameCount, 8) ?? 8) },
        dataChannel: { value: sharedTimelineDataChannel(parameters.channel || parameters.dataChannel) },
      },
      vertexShader,
      fragmentShader: `
        uniform sampler2D map;
        uniform float progress;
        uniform float frameCount;
        uniform float showAmt;
        uniform float storyvrOpacity;
        uniform vec4 dataChannel;
        varying vec2 vUv;
        float ramp(float startValue, float endValue, float value) {
          return clamp((value - startValue) / (endValue - startValue), 0.0, 1.0);
        }
        vec3 concentrationColor(float value) {
          value = clamp(value, 0.0, 1.0);
          vec3 color = mix(vec3(1.0, 1.0, 0.988235), vec3(0.988235, 0.988235, 0.741176), ramp(0.0, 0.1, value));
          color = mix(color, vec3(0.980392, 0.945098, 0.576471), ramp(0.1, 0.2, value));
          color = mix(color, vec3(0.968627, 0.862745, 0.388235), ramp(0.2, 0.3, value));
          color = mix(color, vec3(0.94902, 0.741176, 0.219608), ramp(0.3, 0.4, value));
          color = mix(color, vec3(0.929412, 0.607843, 0.094118), ramp(0.4, 0.5, value));
          color = mix(color, vec3(0.909804, 0.486275, 0.035294), ramp(0.5, 0.6, value));
          color = mix(color, vec3(0.8, 0.305882, 0.0), ramp(0.6, 0.7, value));
          color = mix(color, vec3(0.678431, 0.180392, 0.011765), ramp(0.7, 0.8, value));
          color = mix(color, vec3(0.501961, 0.054902, 0.031373), ramp(0.8, 0.9, value));
          return mix(color, vec3(0.301961, 0.047059, 0.090196), ramp(0.9, 1.0, value));
        }
        void main() {
          float frames = max(2.0, frameCount);
          float frameWidth = 1.0 / frames;
          float framePosition = clamp(progress, 0.0, 0.9999) * (frames - 1.0);
          float firstFrame = floor(framePosition);
          float secondFrame = min(firstFrame + 1.0, frames - 1.0);
          float frameMix = fract(framePosition);
          vec2 firstUv = vec2(vUv.x * frameWidth + firstFrame * frameWidth, vUv.y);
          vec2 secondUv = vec2(vUv.x * frameWidth + secondFrame * frameWidth, vUv.y);
          float firstValue = dot(texture2D(map, firstUv), dataChannel);
          float secondValue = dot(texture2D(map, secondUv), dataChannel);
          float concentration = mix(firstValue, secondValue, frameMix);
          gl_FragColor = vec4(concentrationColor(concentration), concentration * showAmt * storyvrOpacity);
        }
      `,
    });
  } else if (recipe === "layered-texture-atlas-scalar-field") {
    const map = originalMaterial?.map || null;
    if (!map) return null;
    if ("colorSpace" in map) map.colorSpace = THREE.NoColorSpace;
    material = new THREE.ShaderMaterial({
      uniforms: {
        ...commonUniforms,
        map: { value: map },
        sliceY: { value: finiteSharedTimelineNumber(parameters.sliceY, 0) ?? 0 },
        atlasColumns: { value: Math.max(1, finiteSharedTimelineNumber(parameters.atlasColumns, 1) ?? 1) },
        atlasRows: { value: Math.max(1, finiteSharedTimelineNumber(parameters.atlasRows, 1) ?? 1) },
        sampleCount: { value: Math.max(1, finiteSharedTimelineNumber(parameters.sampleCount, 1) ?? 1) },
        dataChannel: { value: sharedTimelineDataChannel(parameters.dataChannel || parameters.channel) },
        scalarGain: { value: finiteSharedTimelineNumber(parameters.scalarGain, 1) ?? 1 },
        alphaFloor: { value: Math.max(0, finiteSharedTimelineNumber(parameters.alphaFloor, 0) ?? 0) },
        atlasOffset: { value: sharedTimelineAtlasOffset(parameters.atlasOffset) },
      },
      vertexShader,
      fragmentShader: `
        uniform sampler2D map;
        uniform float sliceY;
        uniform float atlasColumns;
        uniform float atlasRows;
        uniform float sampleCount;
        uniform float scalarGain;
        uniform float alphaFloor;
        uniform float showAmt;
        uniform float storyvrOpacity;
        uniform vec2 atlasOffset;
        uniform vec4 dataChannel;
        varying vec2 vUv;
        float ramp(float startValue, float endValue, float value) {
          return clamp((value - startValue) / max(endValue - startValue, 0.000001), 0.0, 1.0);
        }
        ${sharedTimelineScalarFieldColorShader(parameters.colorRamp)}
        vec4 sampleAtlas(float sampleIndex) {
          float columns = max(1.0, atlasColumns);
          float rows = max(1.0, atlasRows);
          float column = mod(sampleIndex, columns);
          float row = floor(sampleIndex / columns);
          vec2 atlasUv = (vUv + vec2(column, row)) / vec2(columns, rows) + atlasOffset;
          return texture2D(map, atlasUv);
        }
        void main() {
          float capacity = max(1.0, atlasColumns * atlasRows);
          float samples = clamp(sampleCount, 1.0, capacity);
          float samplePosition = clamp(sliceY, 0.0, 1.0) * (samples - 1.0);
          float firstSample = floor(samplePosition);
          float secondSample = min(firstSample + 1.0, samples - 1.0);
          float sampleMix = fract(samplePosition);
          vec4 data = mix(sampleAtlas(firstSample), sampleAtlas(secondSample), sampleMix);
          float scalar = clamp(dot(data, dataChannel) * scalarGain, 0.0, 1.0);
          float alpha = max(scalar, alphaFloor) * showAmt * storyvrOpacity;
          gl_FragColor = vec4(scalarFieldColor(scalar), alpha);
        }
      `,
    });
  }
  if (!material) return null;
  const render = definition?.render && typeof definition.render === "object" ? definition.render : {};
  material.name = String(definition.id || `${recipe}-material`);
  material.side = sharedTimelineMaterialSide(render.side, originalMaterial?.side ?? THREE.FrontSide);
  material.transparent = render.transparent !== false;
  material.depthWrite = render.depthWrite === true;
  material.depthTest = render.depthTest !== false;
  material.blending = sharedTimelineMaterialBlending(render.blending, originalMaterial?.blending ?? THREE.NormalBlending);
  material.opacity = Number.isFinite(originalMaterial?.opacity) ? originalMaterial.opacity : 1;
  material.toneMapped = render.toneMapped === true;
  material.userData = {
    ...(originalMaterial?.userData || {}),
    storyvrMaterialRecipe: recipe,
    storyvrMaterialRecipeId: String(definition.id || ""),
    storyvrBaseOpacity: material.opacity,
    storyvrBaseTransparent: material.transparent,
    storyvrBaseDepthWrite: material.depthWrite,
    storyvrPreviewOpacity: 1,
    storyvrSourceBindingOpacity: 1,
    storyvrOpaqueAtUniform: sharedTimelineMaterialOpaqueAtUniform(definition),
  };
  material.onBeforeRender = () => {
    if (material.uniforms?.storyvrOpacity) material.uniforms.storyvrOpacity.value = Number.isFinite(material.opacity) ? material.opacity : 1;
  };
  return material;
}

function sharedTimelineMaterialOpaqueAtUniform(definition) {
  const rule = definition?.render?.opaqueAtUniform;
  if (!rule || typeof rule !== "object") return null;
  const uniform = String(rule.uniform || "").trim();
  const threshold = finiteSharedTimelineNumber(rule.threshold);
  return uniform && threshold != null ? { uniform, threshold } : null;
}

function applySharedTimelineMaterialOpaqueAtUniform(material, uniformName, value) {
  const rule = material?.userData?.storyvrOpaqueAtUniform;
  if (!rule || rule.uniform !== uniformName || !Number.isFinite(value)) return false;
  const nextTransparent = value < rule.threshold;
  material.userData.storyvrBaseTransparent = nextTransparent;
  updateSharedTimelineMaterialOpacity(material);
  return true;
}

function initializeSharedTimelineMaterials(root, definitions) {
  const recipes = new Map();
  const diagnostics = [];
  for (const [index, definition] of (definitions || []).entries()) {
    const id = String(definition?.id || `material:${index}`).trim();
    const target = sharedTimelineBindingNode(root, definition?.target || definition?.node || definition?.targetNode);
    if (!target) {
      diagnostics.push(`Material recipe target unavailable: ${id}`);
      continue;
    }
    const recursive = definition?.recursive !== false && definition?.parameters?.recursive !== false;
    const materials = [];
    const nodes = [];
    for (const node of sharedTimelineBindingTargets(target, recursive)) {
      if (!node?.material) continue;
      const originals = Array.isArray(node.material) ? node.material : [node.material];
      const replacements = originals.map((original) => createSharedTimelineMaterial(definition, original)).filter(Boolean);
      if (!replacements.length) continue;
      node.material = Array.isArray(node.material) ? replacements : replacements[0];
      const renderOrder = finiteSharedTimelineNumber(definition?.render?.renderOrder, definition?.renderOrder);
      if (renderOrder != null) node.renderOrder = renderOrder;
      nodes.push(node);
      materials.push(...replacements);
    }
    if (!materials.length) {
      diagnostics.push(`Material recipe unavailable: ${id}:${definition?.recipe || "missing"}`);
      continue;
    }
    recipes.set(id, { id, definition, target, nodes, materials });
  }
  return { recipes, diagnostics };
}

function sharedTimelineBindingMaterials(playback, binding) {
  const target = binding?.target && typeof binding.target === "object" ? binding.target : {};
  const materialId = String(target.material || target.materialId || binding?.material || binding?.materialId || "").trim();
  if (materialId) return playback?.materialRecipes?.get(materialId)?.materials || [];
  const node = sharedTimelineBindingTarget(playback, binding);
  if (!node) return [];
  return sharedTimelineBindingTargets(node, target.recursive !== false)
    .flatMap((item) => Array.isArray(item?.material) ? item.material : item?.material ? [item.material] : []);
}

function applySharedTimelineMaterialUniform(playback, binding, value) {
  const target = binding?.target && typeof binding.target === "object" ? binding.target : {};
  const uniformName = String(target.uniform || binding?.uniform || "").trim();
  const materials = sharedTimelineBindingMaterials(playback, binding);
  if (!uniformName || !Number.isFinite(value) || !materials.length) {
    addSharedTimelineDiagnostic(playback, `material-uniform binding could not resolve ${uniformName || "its uniform"}`);
    return;
  }
  let applied = false;
  for (const material of materials) {
    if (!material?.uniforms || !(uniformName in material.uniforms)) continue;
    material.uniforms[uniformName].value = value;
    applySharedTimelineMaterialOpaqueAtUniform(material, uniformName, value);
    applied = true;
  }
  if (!applied) addSharedTimelineDiagnostic(playback, `material-uniform binding could not resolve ${uniformName}`);
}

function prepareSharedTimelineMaterial(material) {
  if (!material) return;
  const userData = material.userData || {};
  material.userData = {
    ...userData,
    storyvrBaseOpacity: Number.isFinite(userData.storyvrBaseOpacity)
      ? userData.storyvrBaseOpacity
      : (Number.isFinite(material.opacity) ? material.opacity : 1),
    storyvrBaseTransparent: userData.storyvrBaseTransparent ?? Boolean(material.transparent),
    storyvrBaseDepthWrite: userData.storyvrBaseDepthWrite ?? material.depthWrite,
    storyvrPreviewOpacity: Number.isFinite(userData.storyvrPreviewOpacity) ? userData.storyvrPreviewOpacity : 1,
    storyvrSourceBindingOpacity: Number.isFinite(userData.storyvrSourceBindingOpacity) ? userData.storyvrSourceBindingOpacity : 1,
  };
}

function updateSharedTimelineMaterialOpacity(material) {
  if (!material) return;
  prepareSharedTimelineMaterial(material);
  const baseOpacity = Number.isFinite(material.userData.storyvrBaseOpacity) ? material.userData.storyvrBaseOpacity : 1;
  const baseTransparent = Boolean(material.userData.storyvrBaseTransparent);
  const baseDepthWrite = material.userData.storyvrBaseDepthWrite ?? true;
  const previewOpacity = normalizedProgress(material.userData.storyvrPreviewOpacity, 1);
  const sourceOpacity = normalizedProgress(material.userData.storyvrSourceBindingOpacity, 1);
  const nextOpacity = baseOpacity * previewOpacity * sourceOpacity;
  const nextTransparent = baseTransparent || baseOpacity < 0.999 || previewOpacity < 0.999 || sourceOpacity < 0.999;
  const nextDepthWrite = previewOpacity >= 0.999 && sourceOpacity >= 0.999 ? baseDepthWrite : false;
  const transparentChanged = material.transparent !== nextTransparent;
  material.opacity = nextOpacity;
  material.transparent = nextTransparent;
  material.depthWrite = nextDepthWrite;
  if (transparentChanged) material.needsUpdate = true;
}

function updateSharedTimelineRenderableVisibility(node) {
  if (!node) return;
  const baseVisible = node.userData?.storyvrSourcePartBaseVisible ?? true;
  const maskVisible = node.userData?.storyvrSourcePartMaskVisible ?? true;
  const bindingVisible = node.userData?.storyvrSourceBindingVisible ?? true;
  node.visible = Boolean(baseVisible && maskVisible && bindingVisible);
}

function snapVisibilityOpacityEndpoint(opacity, opacityMaximum, fullOpacityThreshold = 0.99) {
  const value = Number(opacity);
  const maximum = Number(opacityMaximum);
  const threshold = Number(fullOpacityThreshold);
  if (!Number.isFinite(value) || !Number.isFinite(maximum)) return opacity;
  if (maximum < 0.999 || !Number.isFinite(threshold)) return value;
  return value >= threshold ? maximum : value;
}

function prepareSharedTimelineBindingState(root) {
  root?.traverse?.((node) => {
    if (!node?.material) return;
    node.userData = node.userData || {};
    if (!("storyvrSourcePartBaseVisible" in node.userData)) node.userData.storyvrSourcePartBaseVisible = node.visible !== false;
    if (!("storyvrSourcePartMaskVisible" in node.userData)) node.userData.storyvrSourcePartMaskVisible = true;
    if (!("storyvrSourceBindingVisible" in node.userData)) node.userData.storyvrSourceBindingVisible = true;
    forEachSharedTimelineMaterial(node, prepareSharedTimelineMaterial);
  });
}

function sharedTimelineBindingTargets(target, recursive) {
  if (!target) return [];
  const targets = [target];
  if (recursive) target.traverse?.((child) => {
    if (child !== target) targets.push(child);
  });
  return targets;
}

function sharedTimelineAnnotationTarget(playback, binding) {
  const target = binding?.target && typeof binding.target === "object" ? binding.target : {};
  const annotationId = String(target.annotationId || target.id || binding?.annotationId || "").trim();
  if (playback?.annotationTargets?.has(annotationId)) return playback.annotationTargets.get(annotationId).element;
  const annotation = (playback?.annotations || []).find((item) => String(item?.id || item?.annotationId || "") === annotationId) || null;
  if (annotation?.element) return annotation.element;
  const node = sharedTimelineBindingNode(playback?.root, annotation?.node || annotation?.nodeName || target.node || target.nodeName);
  if (node) return node;
  if (typeof document === "undefined") return null;
  const selector = annotation?.selector || target.selector;
  if (selector) return document.querySelector(selector);
  const elementId = annotation?.elementId || target.elementId || annotationId;
  return elementId ? document.getElementById(elementId) : null;
}

function sharedTimelineAnnotationIsReaderVisible(definition) {
  if (!definition || typeof definition !== "object") return false;
  if (definition.readerVisible === false || definition.display === false || definition.render === false) return false;
  const text = String(definition.text || definition.label || "").trim();
  if (!text) return false;
  if (definition.readerVisible === true || definition.authoredSceneText === true) return true;
  const id = String(definition.id || definition.annotationId || "").trim();
  const authoredText = String(definition.text || "").trim();
  const hasTarget = [
    definition.node,
    definition.nodeName,
    definition.target,
    definition.selector,
    definition.elementId,
  ].some((value) => typeof value === "string" && value.trim());
  return Boolean(id && authoredText && hasTarget);
}

function initializeSharedTimelineAnnotations(playback) {
  if (typeof document === "undefined" || !stage || !playback?.sharedTimeline) return;
  const presentation = playback.contract?.presentation?.annotations;
  const presentationStyle = presentation && typeof presentation === "object" ? presentation : {};
  for (const [index, definition] of (playback.annotations || []).entries()) {
    if (!sharedTimelineAnnotationIsReaderVisible(definition)) continue;
    const id = String(definition?.id || definition?.annotationId || `annotation:${index}`).trim();
    const label = String(definition?.text || definition?.label || "").trim();
    if (!id || !label) continue;
    const element = document.createElement("div");
    element.dataset.storyvrAnnotation = id;
    element.textContent = label;
    const background = definition.background ?? presentationStyle.background ?? "rgba(255,253,244,0.9)";
    const transparentBackground = !background || String(background).trim().toLowerCase() === "transparent";
    Object.assign(element.style, {
      position: "absolute",
      left: "0",
      top: "0",
      zIndex: "4",
      pointerEvents: "none",
      padding: transparentBackground ? "0" : "0.28rem 0.5rem",
      borderRadius: transparentBackground ? "0" : "0.35rem",
      color: String(definition.color ?? presentationStyle.color ?? "#10201c"),
      background: String(background || "transparent"),
      font: `${Number(definition.fontWeight ?? presentationStyle.fontWeight) || 600} 12px/1.25 system-ui, sans-serif`,
      maxWidth: String(definition.maxWidth ?? presentationStyle.maxWidth ?? "min(32rem, calc(100vw - 24px))"),
      whiteSpace: String(definition.whiteSpace ?? presentationStyle.whiteSpace ?? "normal"),
      textAlign: "center",
      opacity: "0",
      transform: "translate(-50%, -100%)",
    });
    stage.appendChild(element);
    const targetNode = sharedTimelineBindingNode(playback.root, definition.node || definition.nodeName || definition.target);
    const entry = {
      id,
      definition,
      element,
      targetNode,
      worldPosition: new THREE.Vector3(),
    };
    playback.annotationTargets.set(id, entry);
    playback.annotationElements.push(element);
  }
}

function updateSharedTimelineAnnotations(playback, renderCamera) {
  if (!playback?.sharedTimeline || !renderCamera || !playback.annotationTargets?.size) return;
  if (renderer.xr.isPresenting) {
    setSharedTimelineAnnotationsHidden(playback, true);
    return;
  }
  setSharedTimelineAnnotationsHidden(playback, false);
  const stageBounds = stage.getBoundingClientRect();
  const readerPanelBounds = !textPanelMinimized && readerPanel?.getBoundingClientRect
    ? readerPanel.getBoundingClientRect()
    : null;
  const readerPanelOccupiesLeftEdge = readerPanelBounds
    && readerPanelBounds.left <= stageBounds.left + 24
    && readerPanelBounds.right < stageBounds.right - 24;
  const readableStageLeft = readerPanelOccupiesLeftEdge ? readerPanelBounds.right : stageBounds.left;
  for (const entry of playback.annotationTargets.values()) {
    if (!entry.targetNode?.getWorldPosition) continue;
    entry.targetNode.getWorldPosition(entry.worldPosition);
    entry.worldPosition.project(renderCamera);
    const x = stageBounds.left + (entry.worldPosition.x * 0.5 + 0.5) * stageBounds.width;
    const y = stageBounds.top + (-entry.worldPosition.y * 0.5 + 0.5) * stageBounds.height;
    const offset = entry.definition?.offset || {};
    const elementBounds = entry.element.getBoundingClientRect();
    const presentationStyle = playback.contract?.presentation?.annotations || {};
    const margin = Math.max(0, Number(entry.definition?.viewportMargin ?? presentationStyle.viewportMargin) || 12);
    const unclampedLeft = x + (Number(offset.x) || 0);
    const unclampedTop = y + (Number(offset.y) || 0);
    const minimumLeft = readableStageLeft + margin + elementBounds.width / 2;
    const maximumLeft = stageBounds.right - margin - elementBounds.width / 2;
    const minimumTop = stageBounds.top + margin + elementBounds.height;
    const maximumTop = stageBounds.bottom - margin;
    const clampedLeft = maximumLeft >= minimumLeft
      ? THREE.MathUtils.clamp(unclampedLeft, minimumLeft, maximumLeft)
      : stageBounds.left + stageBounds.width / 2;
    const clampedTop = maximumTop >= minimumTop
      ? THREE.MathUtils.clamp(unclampedTop, minimumTop, maximumTop)
      : stageBounds.top + stageBounds.height / 2;
    const left = `${clampedLeft}px`;
    const top = `${clampedTop}px`;
    const visibility = entry.worldPosition.z >= -1 && entry.worldPosition.z <= 1 ? "visible" : "hidden";
    if (entry.element.style.left !== left) entry.element.style.left = left;
    if (entry.element.style.top !== top) entry.element.style.top = top;
    if (entry.element.style.visibility !== visibility) entry.element.style.visibility = visibility;
  }
}

function setSharedTimelineAnnotationsHidden(playback, hidden) {
  if (!playback?.annotationElements?.length || playback.annotationsHiddenForXr === hidden) return;
  playback.annotationsHiddenForXr = hidden;
  for (const element of playback.annotationElements) element.style.visibility = hidden ? "hidden" : "";
}

function applySharedTimelineBinding(playback, binding, progress) {
  const operation = String(binding?.operation || "").trim().toLowerCase().replace(/_/g, "-");
  const rawValue = sharedTimelineBindingValue(playback, binding, progress);
  const value = transformedSharedTimelineBindingValue(rawValue, binding);
  const parameters = sharedTimelineBindingParameters(binding);

  if (operation === "visibility") {
    const target = sharedTimelineBindingTarget(playback, binding);
    if (!target || !Number.isFinite(value)) {
      addSharedTimelineDiagnostic(playback, "visibility binding could not resolve its source or target");
      return;
    }
    const threshold = finiteSharedTimelineNumber(
      parameters.visibleThreshold,
      parameters.visibilityThreshold,
      parameters.threshold,
      binding.visibleThreshold,
      binding.threshold,
      0.001,
    );
    const visible = value >= threshold;
    const recursive = parameters.recursive !== false && binding.recursive !== false;
    for (const item of sharedTimelineBindingTargets(target, recursive)) {
      if (!item || (!item.isMesh && !item.isPoints && !item.isLine && !item.material)) continue;
      item.userData = item.userData || {};
      if (!("storyvrSourcePartBaseVisible" in item.userData)) item.userData.storyvrSourcePartBaseVisible = item.visible !== false;
      item.userData.storyvrSourceBindingVisible = visible;
      updateSharedTimelineRenderableVisibility(item);
    }
    return;
  }

  if (operation === "material-uniform") {
    applySharedTimelineMaterialUniform(playback, binding, value);
    return;
  }

  if (operation === "visibility-opacity") {
    const target = sharedTimelineBindingTarget(playback, binding);
    if (!target || !Number.isFinite(value)) {
      addSharedTimelineDiagnostic(playback, "visibility-opacity binding could not resolve its source or target");
      return;
    }
    const threshold = finiteSharedTimelineNumber(
      parameters.visibleThreshold,
      parameters.visibilityThreshold,
      parameters.threshold,
      binding.visibleThreshold,
      binding.threshold,
      0.001,
    );
    const opacityMinimum = finiteSharedTimelineNumber(
      parameters.opacityMinimum,
      parameters.minOpacity,
      binding.opacityMinimum,
      binding.minOpacity,
      0,
    );
    const opacityMaximum = finiteSharedTimelineNumber(
      parameters.opacityMaximum,
      parameters.maxOpacity,
      binding.opacityMaximum,
      binding.maxOpacity,
      1,
    );
    const fullOpacityThreshold = finiteSharedTimelineNumber(
      parameters.fullOpacityThreshold,
      parameters.opaqueThreshold,
      binding.fullOpacityThreshold,
      binding.opaqueThreshold,
      0.99,
    );
    const clampedOpacity = Math.max(opacityMinimum, Math.min(opacityMaximum, value));
    const opacity = snapVisibilityOpacityEndpoint(clampedOpacity, opacityMaximum, fullOpacityThreshold);
    const visible = binding.visibility === false ? true : value >= threshold;
    const recursive = parameters.recursive !== false && binding.recursive !== false;
    for (const item of sharedTimelineBindingTargets(target, recursive)) {
      if (!item || (!item.isMesh && !item.isPoints && !item.isLine && !item.material)) continue;
      item.userData = item.userData || {};
      if (!("storyvrSourcePartBaseVisible" in item.userData)) item.userData.storyvrSourcePartBaseVisible = item.visible !== false;
      item.userData.storyvrSourceBindingVisible = visible;
      updateSharedTimelineRenderableVisibility(item);
      forEachSharedTimelineMaterial(item, (material) => {
        prepareSharedTimelineMaterial(material);
        material.userData.storyvrSourceBindingOpacity = opacity;
        updateSharedTimelineMaterialOpacity(material);
      });
    }
    return;
  }

  if (operation === "draw-range" || operation === "draw-range-progress") {
    const target = sharedTimelineBindingTarget(playback, binding);
    if (!target || !Number.isFinite(value)) {
      addSharedTimelineDiagnostic(playback, "draw-range binding could not resolve its source or geometry target");
      return;
    }
    const progressValue = normalizedProgress(value, 0);
    const recursive = parameters.recursive !== false && binding.recursive !== false;
    let applied = false;
    for (const item of sharedTimelineBindingTargets(target, recursive)) {
      const geometry = item?.geometry;
      if (!geometry || typeof geometry.setDrawRange !== "function") continue;
      geometry.userData = geometry.userData || {};
      if (!geometry.userData.storyvrSourceDrawRange) {
        const availableCount = Number.isFinite(geometry.drawRange?.count) && geometry.drawRange.count !== Infinity
          ? geometry.drawRange.count
          : geometry.index?.count || geometry.attributes?.position?.count || 0;
        geometry.userData.storyvrSourceDrawRange = {
          start: Number.isFinite(geometry.drawRange?.start) ? geometry.drawRange.start : 0,
          count: Math.max(0, availableCount),
        };
      }
      const base = geometry.userData.storyvrSourceDrawRange;
      const reverse = (parameters.direction || binding.direction) === "reverse";
      const count = Math.max(0, Math.round(base.count * progressValue));
      const start = reverse ? base.start + Math.max(0, base.count - count) : base.start;
      geometry.setDrawRange(start, count);
      applied = true;
    }
    if (!applied) addSharedTimelineDiagnostic(playback, "draw-range binding could not resolve its source or geometry target");
    return;
  }

  if (operation === "camera-focal-length") {
    const target = sharedTimelineBindingTarget(playback, binding) || playback?.sourceCamera;
    if (!target || typeof target.setFocalLength !== "function" || !Number.isFinite(value)) {
      addSharedTimelineDiagnostic(playback, "camera-focal-length binding could not resolve its source or camera target");
      return;
    }
    const rawBase = parameters.baseFocalLength
      ?? parameters.baseValue
      ?? parameters.base
      ?? binding.baseFocalLength
      ?? binding.baseValue
      ?? binding.base;
    const initialBase = finiteSharedTimelineNumber(playback?.initialSourceCameraFocalLength, 0);
    const declaredBase = String(rawBase || "").toLowerCase() === "initial"
      ? initialBase
      : finiteSharedTimelineNumber(rawBase);
    const base = declaredBase ?? initialBase;
    let focalLength = Math.max(0.001, base + value);
    const minimum = finiteSharedTimelineNumber(parameters.minFocalLength, binding.minFocalLength);
    const maximum = finiteSharedTimelineNumber(parameters.maxFocalLength, binding.maxFocalLength);
    if (minimum != null) focalLength = Math.max(minimum, focalLength);
    if (maximum != null) focalLength = Math.min(maximum, focalLength);
    target.setFocalLength(focalLength);
    target.updateProjectionMatrix?.();
    return;
  }

  if (operation === "annotation-opacity") {
    const target = sharedTimelineAnnotationTarget(playback, binding);
    if (!target || !Number.isFinite(value)) {
      addSharedTimelineDiagnostic(playback, "annotation-opacity binding could not resolve its source or annotation target");
      return;
    }
    const opacity = Math.max(0, Math.min(1, value));
    const threshold = Number.isFinite(Number(parameters.visibleThreshold ?? parameters.visibilityThreshold ?? parameters.threshold))
      ? Number(parameters.visibleThreshold ?? parameters.visibilityThreshold ?? parameters.threshold)
      : 0.01;
    if (target.style) target.style.opacity = String(opacity);
    if ("visible" in target) target.visible = opacity >= threshold;
    if (target.userData) target.userData.storyvrAnnotationOpacity = opacity;
    return;
  }

  addSharedTimelineDiagnostic(playback, `Unsupported source binding operation: ${operation || "(missing)"}`);
}

function applySharedTimelineBindings(playback, progress) {
  for (const binding of playback?.bindings || []) applySharedTimelineBinding(playback, binding, progress);
  for (const annotation of playback?.annotations || []) {
    if (!annotation?.opacitySource) continue;
    applySharedTimelineBinding(playback, {
      operation: "annotation-opacity",
      source: annotation.opacitySource,
      target: { annotationId: annotation.id || annotation.annotationId },
      parameters: { visibleThreshold: annotation.visibleThreshold },
    }, progress);
  }
}

function sharedTimelineBindingUsesWallClock(binding) {
  const sourceType = String(binding?.source?.type || binding?.sourceType || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  return sourceType === "wall-clock-time";
}

function applySharedTimelineClockBindings(playback, progress) {
  for (const binding of playback?.wallClockBindings || []) applySharedTimelineBinding(playback, binding, progress);
  for (const annotation of playback?.wallClockAnnotations || []) {
    applySharedTimelineBinding(playback, {
      operation: "annotation-opacity",
      source: annotation.opacitySource,
      target: { annotationId: annotation.id || annotation.annotationId },
      parameters: { visibleThreshold: annotation.visibleThreshold },
    }, progress);
  }
}

function sourcePartSelectorsForBeatAsset(beatId, assetId) {
  return uniqueStrings(sourcePartStates
    .filter((item) => item.beatId === beatId && item.assetId === assetId)
    .filter((item) => sourcePartStateCanApplyHardMask(item, assetId))
    .flatMap((item) => [...(item.partSelectors || []), ...(item.animationTargetSelectors || [])]));
}

function sourcePartStateCanApplyHardMask(partState, assetId) {
  if (!sharedTimelineContractForAsset(assetId)) return true;
  return partState?.provenance === "direct-runtime";
}

function sourcePartStateForBeatAsset(beatId, assetId) {
  return sourcePartStates.find((item) => item.beatId === beatId && item.assetId === assetId) || null;
}

function createFrozenSourcePartPlayback(root, clips, partState) {
  if (!root || !Array.isArray(clips) || !clips.length || !partState) return null;
  const indexes = new Set((partState.animations || [])
    .map((animation) => Number(animation.clipIndex))
    .filter((index) => Number.isInteger(index) && index >= 0));
  const names = new Set((partState.animations || []).map((animation) => animation.clipName).filter(Boolean));
  const selectedClips = clips.filter((clip, index) => indexes.has(index) || names.has(clip.name));
  if (!selectedClips.length) return null;
  const freezeProgress = Math.max(0, Math.min(1, Number(partState.freezeProgress) || 0));
  const mixer = new THREE.AnimationMixer(root);
  const actions = selectedClips.map((clip) => mixer.clipAction(clip));
  for (const action of actions) {
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    action.paused = true;
    action.time = (Number(action.getClip()?.duration) || 0) * freezeProgress;
  }
  mixer.update(0);
  return {
    mixer,
    actions,
    clips: selectedClips,
    mode: "frozen",
    frozen: true,
    freezeProgress,
    stateMode: partState.stateMode || "carry-forward",
  };
}

function expandSourcePartSelectors(selectors) {
  const expand = (value) => {
    const selector = String(value || "").trim();
    if (!selector) return [];
    const plusParts = selector.split(/\s+plus\s+/i);
    if (plusParts.length > 1) return plusParts.flatMap(expand);
    const brace = selector.match(/^(.*?)\{([^{}]+)\}(.*)$/);
    if (brace) return brace[2].split(",").flatMap((choice) => expand(`${brace[1]}${choice.trim()}${brace[3]}`));
    const range = selector.match(/^(.*?)(\d+)\.\.(\d+)(.*)$/);
    if (range) {
      const start = Number(range[2]);
      const end = Number(range[3]);
      const width = Math.max(range[2].length, range[3].length);
      const direction = end >= start ? 1 : -1;
      const values = [];
      for (let number = start; direction > 0 ? number <= end : number >= end; number += direction) {
        values.push(...expand(`${range[1]}${String(number).padStart(width, "0")}${range[4]}`));
      }
      return values;
    }
    return [selector.replace(/^\/+|\/+$/g, "")];
  };
  return uniqueStrings((selectors || []).flatMap(expand));
}

function sourcePartSelectorRegex(selector) {
  const escaped = String(selector || "")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function sourcePartNodePath(node, root) {
  const names = [];
  let current = node;
  while (current && current !== root) {
    if (current.name) names.unshift(current.name);
    current = current.parent;
  }
  return names.join("/");
}

function sourcePartSelectorMatchesNode(selector, node, root) {
  const normalizedSelector = String(selector || "").replace(/^\/+|\/+$/g, "");
  if (!normalizedSelector) return false;
  const path = sourcePartNodePath(node, root);
  const pathParts = path.split("/").filter(Boolean);
  const candidates = uniqueStrings([path, node.name, ...pathParts.map((_, index) => pathParts.slice(index).join("/"))]);
  const pattern = sourcePartSelectorRegex(normalizedSelector);
  if (candidates.some((candidate) => pattern.test(candidate))) return true;
  if (!normalizedSelector.includes("*")) {
    const lowerSelector = normalizedSelector.toLowerCase();
    return candidates.some((candidate) => {
      const lowerCandidate = candidate.toLowerCase();
      return lowerCandidate === lowerSelector || lowerCandidate.startsWith(`${lowerSelector}/`) || lowerCandidate.includes(`/${lowerSelector}/`);
    });
  }
  return false;
}

function applySourcePartMask(root, selectors) {
  if (!root?.traverse) return { applied: false, matched: 0, renderables: 0 };
  const expanded = expandSourcePartSelectors(selectors);
  const renderables = [];
  root.traverse((node) => {
    if (!node.isMesh && !node.isPoints && !node.isLine) return;
    if (!("storyvrSourcePartBaseVisible" in node.userData)) node.userData.storyvrSourcePartBaseVisible = node.visible !== false;
    renderables.push(node);
  });
  if (!expanded.length) {
    for (const node of renderables) node.visible = node.userData.storyvrSourcePartBaseVisible;
    return { applied: false, matched: 0, renderables: renderables.length };
  }
  const matched = renderables.filter((node) => expanded.some((selector) => sourcePartSelectorMatchesNode(selector, node, root)));
  if (!matched.length) {
    for (const node of renderables) node.visible = node.userData.storyvrSourcePartBaseVisible;
    return { applied: false, matched: 0, renderables: renderables.length, fallback: true };
  }
  const matchedSet = new Set(matched);
  for (const node of renderables) node.visible = node.userData.storyvrSourcePartBaseVisible && matchedSet.has(node);
  return { applied: true, matched: matched.length, renderables: renderables.length };
}

function sourceCameraForTrack(sourceCameras, track) {
  const cameras = Array.isArray(sourceCameras) ? sourceCameras : [];
  if (!cameras.length) return null;
  const requestedIndex = Number(track?.cameraIndex ?? track?.cameraIndexes?.[0]);
  return Number.isInteger(requestedIndex) && requestedIndex >= 0
    ? cameras[requestedIndex] || null
    : cameras[0];
}

function sharedTimelineSourceCamera(sourceCameras, camera) {
  const cameras = Array.isArray(sourceCameras) ? sourceCameras : [];
  const cameraIndex = camera?.cameraIndex;
  return Number.isInteger(cameraIndex) && cameraIndex >= 0 ? cameras[cameraIndex] || null : null;
}

function createLegacySourceAnimationPlayback(root, clips, asset, beat, transitionSegment = null) {
  if (!Array.isArray(clips) || !clips.length) return null;
  const dynamicsLinks = sourceDynamicsLinksForBeat(beat)
    .filter((link) => link.assetId === asset.id);
  const withinBeat = dynamicGeometryEnabled
    ? dynamicsLinks.find((link) => link.classification === "within-beat-dynamics" && link.hasEmbeddedAnimation)
    : null;
  const segment = transitionSegment;
  if (!withinBeat && !segment) return null;

  const mixer = new THREE.AnimationMixer(root);
  const actions = clips.map((clip) => mixer.clipAction(clip));
  if (segment) {
    for (const action of actions) {
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
    }
    const clipSpanSeconds = Math.max(...clips.map((clip) => Number(clip.duration) || 0), 1) * Math.abs(segment.endProgress - segment.startProgress);
    const playback = {
      mixer,
      actions,
      clips,
      mode: "segment",
      segment,
      elapsed: 0,
      transitionStartedAtMs: performance.now(),
      durationSeconds: Math.max(0.9, Math.min(2.4, clipSpanSeconds || 1.2)),
    };
    applySourceAnimationSegment(playback, 0);
    return playback;
  }

  for (const action of actions) {
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
  }
  return { mixer, actions, clips, mode: "loop", segment: null };
}

function updateSupplementalSourceAnimations(delta, frameTime = performance.now()) {
  for (const entry of activeSupplementalModelEntries) {
    const playback = entry.playback;
    if (!playback) continue;
    if (playback.sharedTimeline) {
      playback.clockSeconds = (Number(playback.clockSeconds) || 0) + delta;
      if (playback.mode !== "segment") applySharedTimelineClockBindings(playback, playback.currentProgress ?? 0);
    }
    if (playback.mode === "frozen") continue;
    if (playback.mode === "loop") {
      playback.mixer.update(delta);
      continue;
    }
    if (playback.mode !== "segment") continue;
    const wallClockElapsed = Number.isFinite(Number(playback.transitionStartedAtMs))
      ? Math.max(0, (frameTime - Number(playback.transitionStartedAtMs)) / 1000)
      : playback.elapsed + delta;
    playback.elapsed = Math.min(playback.durationSeconds, wallClockElapsed);
    const progress = playback.durationSeconds > 0 ? playback.elapsed / playback.durationSeconds : 1;
    applySourceAnimationSegment(playback, progress);
    if (progress >= 1) {
      playback.mode = "segment-complete";
      if (!playback.sharedTimeline) applySourcePartMask(entry.model, playback.destinationPartSelectors || []);
    }
  }
}

function updateSourceAnimation(delta, frameTime = performance.now()) {
  updateSupplementalSourceAnimations(delta, frameTime);
  if (!activeSourceAnimation) return;
  if (activeSourceAnimation.sharedTimeline) {
    activeSourceAnimation.clockSeconds = (Number(activeSourceAnimation.clockSeconds) || 0) + delta;
    if (activeSourceAnimation.mode !== "segment") {
      applySharedTimelineClockBindings(activeSourceAnimation, activeSourceAnimation.currentProgress ?? 0);
    }
  }
  if (activeSourceAnimation.mode === "frozen") return;
  if (activeSourceAnimation.mode === "loop") {
    activeSourceAnimation.mixer.update(delta);
    return;
  }
  if (activeSourceAnimation.mode === "segment") {
    const wallClockElapsed = Number.isFinite(Number(activeSourceAnimation.transitionStartedAtMs))
      ? Math.max(0, (frameTime - Number(activeSourceAnimation.transitionStartedAtMs)) / 1000)
      : activeSourceAnimation.elapsed + delta;
    activeSourceAnimation.elapsed = Math.min(activeSourceAnimation.durationSeconds, wallClockElapsed);
    const progress = activeSourceAnimation.durationSeconds > 0
      ? activeSourceAnimation.elapsed / activeSourceAnimation.durationSeconds
      : 1;
    applySourceAnimationSegment(activeSourceAnimation, progress);
    if (progress >= 1) {
      activeSourceAnimation.mode = "segment-complete";
      if (activeModel && !activeSourceAnimation.sharedTimeline) {
        applySourcePartMask(activeModel, activeSourceAnimation.destinationPartSelectors || []);
      }
    }
  }
}

function applySourceAnimationSegment(playback, progress) {
  const normalized = Math.max(0, Math.min(1, progress));
  if (playback.sharedTimeline) {
    const segmentProgress = THREE.MathUtils.lerp(playback.segment.startProgress, playback.segment.endProgress, normalized);
    seekSharedTimelinePlayback(playback, segmentProgress);
    return;
  }
  if (Array.isArray(playback.actionEntries) && playback.actionEntries.length) {
    for (const entry of playback.actionEntries) {
      const segmentProgress = THREE.MathUtils.lerp(entry.startProgress, entry.endProgress, normalized);
      entry.action.time = (Number(entry.clip?.duration) || 0) * segmentProgress;
    }
  } else {
    const segmentProgress = THREE.MathUtils.lerp(playback.segment.startProgress, playback.segment.endProgress, normalized);
    for (const action of playback.actions) {
      const duration = Number(action.getClip()?.duration) || 0;
      action.time = duration * segmentProgress;
    }
  }
  playback.mixer.update(0);
}

function transitionSegmentForBeatChange(fromIndex, toIndex, assetId) {
  if (fromIndex === toIndex) return null;
  for (const assetDynamics of sourceDynamicsAssets()) {
    if (assetId && assetDynamics.assetId !== assetId) continue;
    for (const segment of assetDynamics.transitionSegments || []) {
      if (segment.fromIndex === fromIndex && segment.toIndex === toIndex) return segment;
      if (segment.fromIndex === toIndex && segment.toIndex === fromIndex) {
        return {
          ...segment,
          fromIndex,
          toIndex,
          startProgress: segment.endProgress,
          endProgress: segment.startProgress,
        };
      }
    }
  }
  return null;
}

function sourceDynamicsLinksForBeat(beat, graphBeat = graphBeats.get(beat?.id)) {
  const links = [
    ...(beat?.sourceDynamics?.links || []),
    ...(graphBeat?.sourceDynamics?.links || []),
    ...(Array.isArray(beat?.animationProbeLinks) ? beat.animationProbeLinks : []),
    ...(Array.isArray(graphBeat?.animationProbeLinks) ? graphBeat.animationProbeLinks : []),
  ];
  const seen = new Set();
  return links.map((link) => ({
    ...link,
    classification: normalizeDynamicsClassification(link.classification),
    hasEmbeddedAnimation: Boolean(link.hasEmbeddedAnimation),
  })).filter((link) => {
    const key = `${link.assetId}|${link.classification}`;
    if (!link.assetId || seen.has(key)) return false;
    seen.add(key);
    return Boolean(link.classification || link.hasEmbeddedAnimation);
  });
}

function sourceDynamicsAssets() {
  return runtime.sourceDynamics?.assets
    || runtime.sceneTopology?.storyGraph?.sourceDynamics?.assets
    || [];
}

function normalizeDynamicsClassification(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("within")) return "within-beat-dynamics";
  if (text.includes("inter")) return "inter-beat-dynamics";
  return "";
}

function sourceAnimationStatusText() {
  if (!activeSourceAnimation) return "";
  if (activeSourceAnimation.sharedTimeline) {
    const diagnosticCount = activeSourceAnimation.diagnostics?.length || 0;
    const diagnostics = diagnosticCount
      ? `; ${diagnosticCount} source binding diagnostic${diagnosticCount === 1 ? "" : "s"}`
      : "";
    if (activeSourceAnimation.mode === "frozen") {
      const progress = Math.round((activeSourceAnimation.currentProgress || 0) * 100);
      const label = activeSourceAnimation.boundaryMode === "initialize"
        ? "showing initial shared-timeline state"
        : "holding shared-timeline state";
      return `; ${label} at ${progress}%${diagnostics}`;
    }
    if (activeSourceAnimation.cameraUnavailable) {
      return `; shared-timeline source camera unavailable; using the reader camera${diagnostics}`;
    }
    const start = Math.round(activeSourceAnimation.segment.startProgress * 100);
    const end = Math.round(activeSourceAnimation.segment.endProgress * 100);
    return `; scrubbing ${activeSourceAnimation.actions.length} coordinated source animation${activeSourceAnimation.actions.length === 1 ? "" : "s"} (${start}-${end}%)${diagnostics}`;
  }
  if (activeSourceAnimation.mode === "frozen") {
    return activeSourceAnimation.stateMode === "pre-animation"
      ? "; showing source model before its first animation"
      : "; holding the previous source model state without animation";
  }
  if (activeSourceAnimation.mode === "loop") {
    const clipCount = activeSourceAnimation.sourceMotion ? activeSourceAnimation.actions.length : null;
    return clipCount == null
      ? "; looping source within-beat animation"
      : `; looping ${clipCount} assigned source animation${clipCount === 1 ? "" : "s"}`;
  }
  if (activeSourceAnimation.sourceCamera) {
    return "; source camera motion retained while preserving the reader view";
  }
  if (activeSourceAnimation.cameraUnavailable) {
    return "; assigned source camera is unavailable; using the reader camera";
  }
  if (activeSourceAnimation.segment) {
    const start = Math.round(activeSourceAnimation.segment.startProgress * 100);
    const end = Math.round(activeSourceAnimation.segment.endProgress * 100);
    const clipCount = activeSourceAnimation.sourceMotion ? activeSourceAnimation.actions.length : null;
    return clipCount == null
      ? `; playing source transition segment ${start}-${end}%`
      : `; playing ${clipCount} assigned transition animation${clipCount === 1 ? "" : "s"} (${start}-${end}%)`;
  }
  return "";
}

function designChips() {
  const decisions = runtime.provenance?.decisions || {};
  return [
    decisions["asset-topology"]?.option?.label,
    decisions["dynamic-geometry"]?.option?.label,
    decisions["inter-beat-dynamics"]?.option?.label,
    decisions["environment-enhancement"]?.option?.label,
    decisions["spatial-relations"]?.option?.label || decisions["text-comfort"]?.option?.label,
    decisions["attention-guidance"]?.option?.label,
    decisions["interaction-control"]?.option?.label,
    decisions["transition-pacing"]?.option?.label,
  ].filter(Boolean);
}

function finalTuningFromRuntime(runtimeData) {
  const decision = runtimeData?.provenance?.decisions?.["transition-pacing"] || {};
  const prompt = String(
    runtimeData?.finalTuning?.prompt
      ?? runtimeData?.provenance?.finalTuningPrompt
      ?? decision.finalTuningPrompt
      ?? decision.authorEdits
      ?? "",
  ).trim();
  return {
    prompt,
    directives: {
      ...finalTuningDirectivesForPrompt(prompt),
      ...(runtimeData?.finalTuning?.directives || {}),
    },
  };
}

function normalizeRuntimePerformanceOptimization(value) {
  const supplied = value?.status === "applied" && value.settings && typeof value.settings === "object"
    ? value.settings
    : {};
  return {
    status: value?.status === "applied" ? "applied" : "unchanged",
    profile: ["quality", "balanced", "performance"].includes(value?.profile) ? value.profile : "unchanged",
    settings: {
      desktopPixelRatioCap: boundedRuntimePerformanceNumber(supplied.desktopPixelRatioCap, 2, 1, 2),
      antialias: typeof supplied.antialias === "boolean" ? supplied.antialias : true,
      desktopShadows: typeof supplied.desktopShadows === "boolean" ? supplied.desktopShadows : true,
      xrFramebufferScaleFactor: boundedRuntimePerformanceNumber(
        supplied.xrFramebufferScaleFactor,
        XR_FRAMEBUFFER_SCALE_FACTOR,
        0.65,
        1,
      ),
      xrFixedFoveation: boundedRuntimePerformanceNumber(supplied.xrFixedFoveation, XR_FIXED_FOVEATION, 0, 1),
    },
  };
}

function boundedRuntimePerformanceNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function finalTuningDirectivesForPrompt(prompt) {
  const text = String(prompt || "").toLowerCase();
  const suppress = /\b(no|not|hide|remove|disable|without|exclude|avoid|clear|suppress)\b/.test(text);
  const ground = /\b(ground|floor|surface|base|stage)\b/.test(text);
  const circles = /\b(circle|circles|ring|rings|halo|halos|outline|outlines)\b/.test(text);
  const particles = /\b(particle|particles|particle-field|particlefield|specks|sparkles)\b/.test(text);
  return {
    hideGroundCircles: suppress && ground && circles,
    hideDecorativeParticles: suppress && particles,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
