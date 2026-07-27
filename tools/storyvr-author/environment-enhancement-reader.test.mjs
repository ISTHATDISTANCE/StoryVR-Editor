import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeGroundMovementCue } from "./ground-movement-cue.js";

const source = await readFile(new URL("./reader-template/src/main.js", import.meta.url), "utf8");
const html = await readFile(new URL("./reader-template/index.html", import.meta.url), "utf8");
const cueSource = await readFile(new URL("./ground-movement-cue.js", import.meta.url), "utf8");
const engineSource = await readFile(new URL("./engine.mjs", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("reader normalizes and loads panorama or model environments for the active beat", () => {
  const normalizeEnvironment = functionSource("normalizeRuntimeEnvironmentEnhancement");
  const loadEnvironment = functionSource("loadRuntimeEnvironmentEnhancement");
  assert.match(source, /runtime\.environmentEnhancement/);
  assert.match(source, /new HDRLoader\(\)/);
  assert.match(source, /new EXRLoader\(\)/);
  assert.match(loadEnvironment, /new THREE\.TextureLoader\(\)/);
  assert.match(loadEnvironment, /format === "png"\) loadedTexture\.colorSpace = THREE\.SRGBColorSpace/);
  assert.match(loadEnvironment, /loadedTexture\.mapping = THREE\.EquirectangularReflectionMapping/);
  assert.match(normalizeEnvironment, /\["hdr", "exr", "png"\]\.includes\(format\)/);
  assert.match(normalizeEnvironment, /mediaType === "image\/png"/);
  assert.match(source, /new KTX2Loader\(\)/);
  assert.match(source, /setMeshoptDecoder\(MeshoptDecoder\)/);
  assert.match(loadEnvironment, /environmentRoot\.add\(loadedModel\)/);
  assert.match(functionSource("applyRuntimeEnvironmentEnhancement"), /toneMappingExposure/);
  assert.match(functionSource("applyRuntimeEnvironmentEnhancement"), /FogExp2/);
  assert.match(functionSource("applyRuntimeEnvironmentEnhancement"), /environmentRotation\.y/);
  assert.match(functionSource("applyRuntimeEnvironmentEnhancement"), /backgroundRotation\.y/);
  assert.match(functionSource("runtimeEnvironmentAssetUrl"), /readerPublicBaseUrl/);
  assert.doesNotMatch(functionSource("runtimeEnvironmentAssetUrl"), /window\.location\.origin/);
});

test("reader resolves an explicit beat assignment before the default and switches inside setBeat", () => {
  const normalizeAssignments = functionSource("normalizeRuntimeEnvironmentAssignments");
  const resolveEnvironment = functionSource("runtimeEnvironmentEnhancementForBeat");
  const switchEnvironment = functionSource("switchRuntimeEnvironmentEnhancement");
  const setBeat = functionSource("setBeat");
  assert.match(normalizeAssignments, /storyvr-environment-enhancement-assignments\/v2/);
  assert.match(normalizeAssignments, /defaultEnvironment: normalizeRuntimeEnvironmentEnhancement\(source, decision\)/);
  assert.match(normalizeAssignments, /assignmentsByBeat\[normalizedBeatId\] = environment === null/);
  assert.match(resolveEnvironment, /Object\.hasOwn\(runtimeEnvironmentAssignments\.assignmentsByBeat, beatId\)/);
  assert.match(resolveEnvironment, /return runtimeEnvironmentAssignments\.defaultEnvironment/);
  assert.match(setBeat, /switchRuntimeEnvironmentEnhancement\(beat, loadRevision\)/);
  assert.match(switchEnvironment, /clearRuntimeEnvironmentEnhancement\(\)/);
  assert.match(switchEnvironment, /neutralEnvironmentRoot\.visible = !result\.loaded/);
});

test("reader rejects stale asynchronous environment loads and disposes their resources", () => {
  const loadEnvironment = functionSource("loadRuntimeEnvironmentEnhancement");
  assert.match(loadEnvironment, /loadRevision !== activeSceneLoadRevision/);
  assert.match(loadEnvironment, /loadedTexture\?\.dispose\(\)/);
  assert.match(loadEnvironment, /disposeRuntimeEnvironmentObject\(loadedModel\)/);
  assert.match(loadEnvironment, /reason: "stale"/);
  assert.match(functionSource("clearRuntimeEnvironmentEnhancement"), /environmentTexture\?\.dispose\(\)/);
  assert.match(functionSource("clearRuntimeEnvironmentEnhancement"), /environmentRoot\.remove\(child\)/);
});

test("reader template resolves Three and decoder assets from nested story folders", () => {
  assert.match(html, /"three": "\/node_modules\/three\/build\/three\.module\.js"/);
  assert.match(html, /"three\/addons\/": "\/node_modules\/three\/examples\/jsm\/"/);
  assert.doesNotMatch(html, /\.\.\/\.\.\/node_modules\/three/);
  assert.match(source, /import\.meta\.env\?\.DEV/);
  assert.match(source, /new URL\(\/\* @vite-ignore \*\/ "\.\.\/public\/", import\.meta\.url\)\.href/);
  assert.match(source, /import\.meta\.env\?\.BASE_URL/);
  assert.match(source, /window\.location\.href/);
});

test("reader preserves its camera and removes synthetic surroundings when environment loading succeeds", () => {
  assert.match(functionSource("loadRuntimeEnvironmentEnhancement"), /node\.isCamera/);
  assert.match(functionSource("updateHabitat"), /if \(environmentLoaded\)/);
  assert.match(source, /const neutralEnvironmentRoot = createRoom\(\)/);
  assert.match(functionSource("switchRuntimeEnvironmentEnhancement"), /neutralEnvironmentRoot\.visible = !result\.loaded/);
  assert.match(source, /alpha: true/);
  assert.match(functionSource("expandCameraRangeForEnvironment"), /camera\.far/);
  assert.doesNotMatch(functionSource("loadRuntimeEnvironmentEnhancement"), /scene\.add\([^)]*camera/);
});

test("neutral reader habitat does not create a synthetic marker sphere", () => {
  const updateHabitat = functionSource("updateHabitat");
  assert.doesNotMatch(updateHabitat, /SphereGeometry|habitatLabel|particleColor/);
  assert.doesNotMatch(source, /function habitatLabel\(|function particleColor\(/);
});

test("reader aligns the WebXR reference-space origin with the authored environment viewpoint", () => {
  assert.match(source, /sessionstart[\s\S]*captureXrEntryPose\(\)/);
  assert.match(functionSource("captureXrEntryPose"), /camera\.getWorldPosition\(xrEntryWorldPosition\)/);
  assert.match(functionSource("captureXrEntryPose"), /authoredReaderStationForBeat\(beats\[activeIndex\], activeIndex\)/);
  assert.match(functionSource("captureXrEntryPose"), /worldReaderPositionForStation\(station\)/);
  assert.match(functionSource("captureXrEntryPose"), /xrEntryWorldPosition\.z = stationPosition\.z/);
  assert.match(functionSource("captureXrEntryPose"), /if \(station\.readerEntityId\) xrEntryWorldPosition\.copy\(stationPosition\)/);
  assert.match(functionSource("captureXrEntryPose"), /worldReaderQuaternionForStation\(station\)/);
  assert.match(functionSource("alignXrEntryPose"), /xrFrame\.getViewerPose\(referenceSpace\)/);
  assert.match(functionSource("alignXrEntryPose"), /readerRig\.position\.copy\(xrEntryWorldPosition\)\.sub\(xrEntryLocalPosition\)/);
  assert.match(functionSource("render"), /alignXrEntryPose\(xrFrame\)/);
});

test("reader exposes environment provenance and uses the canonical checkpoint id", () => {
  assert.match(html, /id="environment-info"/);
  assert.match(functionSource("designChips"), /environment-enhancement/);
  assert.doesNotMatch(functionSource("designChips"), /context-layering/);
  assert.match(functionSource("renderEnvironmentInformation"), /noopener noreferrer/);
});

test("reader treats an explicit skipped environment as no runtime asset and keeps its neutral fallback", () => {
  const hasPolicy = new Function(
    `${functionSource("hasAuthoredRuntimeEnvironmentPolicy")}
    return hasAuthoredRuntimeEnvironmentPolicy;`,
  )();
  assert.match(functionSource("normalizeRuntimeEnvironmentEnhancement"), /if \(!source\) return null/);
  assert.match(functionSource("normalizeRuntimeEnvironmentAssignments"), /defaultEnvironment: null/);
  assert.match(functionSource("switchRuntimeEnvironmentEnhancement"), /neutralEnvironmentRoot\.visible = true/);
  assert.match(functionSource("loadRuntimeEnvironmentEnhancement"), /reason: "not-authored"/);
  assert.match(functionSource("clearRuntimeEnvironmentEnhancement"), /scene\.fog = null/,
    "the neutral reader preserves authored source colors instead of fogging them to black");
  assert.match(functionSource("renderEnvironmentInformation"), /environmentInfo\.hidden = true/);
  assert.equal(hasPolicy({
    environmentEnhancement: null,
    provenance: {
      decisions: {
        "environment-enhancement": {
          option: {
            optionId: "environment-enhancement-no-added-environment",
            environmentEnhancementSkipped: true,
            environmentEnhancement: null,
          },
        },
      },
    },
  }), true, "a compiled No added environment decision is still an authored environment policy");
  assert.equal(hasPolicy({ environmentEnhancement: null, provenance: { decisions: {} } }), false,
    "legacy runtimes without an Environment Enhancement decision retain their source presentation");
});

test("source playback presentation preserves source background only without an authored environment policy", () => {
  const syncPresentation = functionSource("syncSourcePlaybackPresentation");
  assert.match(syncPresentation, /playback\?\.sharedTimeline \? playback\.contract : null/);
  assert.match(syncPresentation, /presentation\?\.authoredGround === true/);
  assert.match(syncPresentation, /neutralEnvironmentRoot\.visible = !authoredGround/);
  assert.match(syncPresentation, /runtimeHasAuthoredEnvironmentPolicy\s*\?\s*null\s*:\s*sourcePlaybackPresentationBackground\(contract\)/,
    "Environment Enhancement owns the background whenever that checkpoint was explicitly authored");
  assert.ok(
    syncPresentation.indexOf("neutralEnvironmentRoot.visible = !authoredGround")
      < syncPresentation.indexOf("activeSourcePresentationSignature === signature"),
    "the source-authored floor wins even after an asynchronous neutral-environment refresh",
  );
  assert.match(syncPresentation, /scene\.background = background/);
  assert.match(functionSource("render"), /syncSourcePlaybackPresentation\(activeSourceAnimation\)/);
});

test("ground movement cues preserve generated texture evidence and bounded real-world dimensions", () => {
  assert.deepEqual(normalizeGroundMovementCue(), {
    enabled: false,
    style: "sand",
    texture: null,
    rotationY: 0,
    position: [0, 0.004, -0.4],
    widthMeters: 2,
    depthMeters: 1.5,
    thicknessMeters: 0.008,
    textureScaleMeters: 0.2,
    opacity: 0.55,
  });
  assert.deepEqual(normalizeGroundMovementCue({
    enabled: true,
    style: "unknown",
    position: [-200, 0.01, 200],
    widthMeters: 0,
    depthMeters: 400,
    thicknessMeters: 0,
    textureScaleMeters: 10,
    opacity: 2,
  }), {
    enabled: true,
    style: "sand",
    texture: null,
    rotationY: 0,
    position: [-100, 0.01, 100],
    widthMeters: 0.1,
    depthMeters: 200,
    thicknessMeters: 0.001,
    textureScaleMeters: 5,
    opacity: 1,
  });
  assert.deepEqual(normalizeGroundMovementCue({
    enabled: true,
    style: "sand",
    rotationY: Math.PI / 3,
    texture: {
      role: "ground-texture",
      localUrl: "/environment-assets/generated/ground.png",
      publicPath: "environment-enhancement/generated/ground.png",
      entryPath: "generated/ground.png",
      format: "png",
      mediaType: "image/png",
      sha256: "a".repeat(64),
      bytes: 2048,
      generation: { provider: "codex-cli" },
    },
  }), {
    enabled: true,
    style: "generated",
    texture: {
      role: "ground-texture",
      localUrl: "/environment-assets/generated/ground.png",
      publicPath: "environment-enhancement/generated/ground.png",
      entryPath: "generated/ground.png",
      format: "png",
      mediaType: "image/png",
      sha256: "a".repeat(64),
      bytes: 2048,
      generation: { provider: "codex-cli" },
    },
    rotationY: Math.PI / 3,
    position: [0, 0.004, -0.4],
    widthMeters: 2,
    depthMeters: 1.5,
    thicknessMeters: 0.008,
    textureScaleMeters: 0.2,
    opacity: 0.55,
  });
  assert.equal(normalizeGroundMovementCue({
    texture: { role: "ground-texture", publicPath: "" },
  }).style, "sand");
  assert.equal(normalizeGroundMovementCue({ opacity: null }).opacity, 0.55);
  assert.equal(normalizeGroundMovementCue({ opacity: Number.NaN }).opacity, 0.55);
});

test("shared ground cue loads a generated texture with a deterministic sand fallback and explicit disposal", () => {
  assert.match(cueSource, /new THREE\.CanvasTexture\(canvas\)/);
  assert.match(cueSource, /new THREE\.TextureLoader\(\)/);
  assert.match(cueSource, /new THREE\.BoxGeometry\(1, 1, 1\)/);
  assert.match(cueSource, /new THREE\.MeshStandardMaterial/);
  assert.match(cueSource, /transparent: true/);
  assert.match(cueSource, /depthWrite: false/);
  assert.match(cueSource, /material\.opacity = config\.opacity/);
  assert.match(cueSource, /texture\.colorSpace = THREE\.SRGBColorSpace/);
  assert.match(cueSource, /texture\.generateMipmaps = true/);
  assert.match(cueSource, /getMaxAnisotropy/);
  assert.match(cueSource, /texture\.repeat\.set/);
  assert.match(cueSource, /seededRandom\(SAND_TEXTURE_SEED\)/);
  assert.doesNotMatch(cueSource, /Math\.random/);
  assert.match(cueSource, /revision !== textureLoadRevision/);
  assert.match(cueSource, /material\.map = texture/);
  assert.match(cueSource, /material\.map = fallbackTexture/);
  assert.match(cueSource, /mesh\.rotation\.set\(0, config\.rotationY, 0\)/);
  assert.match(cueSource, /controller\.update\(config, \{ textureUrl \}\)/);
  assert.match(cueSource, /mesh\.removeFromParent\(\)/);
  assert.match(cueSource, /geometry\.dispose\(\)/);
  assert.match(cueSource, /material\.dispose\(\)/);
  assert.match(cueSource, /texture\.dispose\(\)/);
});

test("reader adds the cue directly to the world only after its panorama loads and disposes it on pagehide", () => {
  assert.match(functionSource("normalizeRuntimeEnvironmentEnhancement"), /movementCue: normalizeGroundMovementCue\(source\.movementCue\)/);
  assert.match(
    functionSource("loadRuntimeEnvironmentEnhancement"),
    /environmentLoaded = true;\s*if \(runtimeEnvironment\.kind === "panorama"\) installRuntimeGroundMovementCue\(runtimeEnvironment\)/,
  );
  assert.match(functionSource("installRuntimeGroundMovementCue"), /runtimeEnvironment\?\.movementCue\?\.enabled !== true/);
  assert.match(functionSource("installRuntimeGroundMovementCue"), /rotationY: runtimeEnvironment\.transform\.rotationY/);
  assert.match(functionSource("installRuntimeGroundMovementCue"), /runtimeEnvironmentAssetUrl\(movementCue\.texture\.publicPath\)/);
  assert.match(functionSource("installRuntimeGroundMovementCue"), /createGroundMovementCue\(movementCue, \{ renderer, textureUrl \}\)/);
  assert.match(functionSource("installRuntimeGroundMovementCue"), /scene\.add\(cue\.mesh\)/);
  assert.doesNotMatch(functionSource("installRuntimeGroundMovementCue"), /(?:environmentRoot|readerRig)\.add/);
  assert.match(source, /window\.addEventListener\("pagehide", disposeRuntimeEnvironmentEnhancement, \{ once: true \}\)/);
  assert.match(functionSource("disposeRuntimeGroundMovementCue"), /groundMovementCue\?\.dispose\(\)/);
  assert.match(functionSource("clearRuntimeEnvironmentEnhancement"), /disposeRuntimeGroundMovementCue\(\)/);
  assert.match(engineSource, /\{ source: "ground-movement-cue\.js", target: "src\/ground-movement-cue\.js" \}/);
});
