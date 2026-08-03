import * as THREE from "three";

const DEFAULT_MOVEMENT_CUE = Object.freeze({
  enabled: false,
  style: "sand",
  coverage: "bounded",
  texture: null,
  rotationY: 0,
  position: Object.freeze([0, 0.004, -0.4]),
  widthMeters: 2,
  depthMeters: 1.5,
  thicknessMeters: 0.008,
  textureScaleMeters: 0.2,
  opacity: 0.55,
});

export const INFINITE_GROUND_MIN_TILE_SIZE_METERS = 512;
export const INFINITE_GROUND_RECENTER_TARGET_METERS = 8;
const INFINITE_GROUND_FAR_CORNER_MARGIN = 1.05;
const INFINITE_GROUND_CENTER_CELL_SIZE_METERS = 64;

const SAND_TEXTURE_SIZE = 512;
const SAND_TEXTURE_SEED = 0x51a7d;

export function normalizeGroundMovementCue(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const position = Array.isArray(source.position) ? source.position : DEFAULT_MOVEMENT_CUE.position;
  const texture = normalizeGeneratedGroundTexture(source.texture);
  return {
    enabled: source.enabled === true,
    style: texture ? "generated" : "sand",
    coverage: source.coverage === "infinite" ? "infinite" : "bounded",
    texture,
    rotationY: boundedNumber(
      source.rotationY,
      DEFAULT_MOVEMENT_CUE.rotationY,
      -Math.PI * 2,
      Math.PI * 2,
    ),
    position: [0, 1, 2].map((index) => boundedNumber(
      position[index],
      DEFAULT_MOVEMENT_CUE.position[index],
      -100,
      100,
    )),
    widthMeters: boundedNumber(source.widthMeters, DEFAULT_MOVEMENT_CUE.widthMeters, 0.1, 200),
    depthMeters: boundedNumber(source.depthMeters, DEFAULT_MOVEMENT_CUE.depthMeters, 0.1, 200),
    thicknessMeters: boundedNumber(
      source.thicknessMeters,
      DEFAULT_MOVEMENT_CUE.thicknessMeters,
      0.001,
      0.25,
    ),
    textureScaleMeters: boundedNumber(
      source.textureScaleMeters,
      DEFAULT_MOVEMENT_CUE.textureScaleMeters,
      0.02,
      5,
    ),
    opacity: boundedNumber(source.opacity, DEFAULT_MOVEMENT_CUE.opacity, 0, 1),
  };
}

/**
 * Keeps an infinite-coverage ground patch near the viewer while moving it only
 * by whole texture periods. The generated texture therefore stays fixed in the
 * authored world instead of visibly swimming as the viewer travels.
 */
export function infiniteGroundCuePosition(value, cameraPosition) {
  const config = normalizeGroundMovementCue(value);
  return infiniteGroundCuePositionFromConfig(config, cameraPosition);
}

export function infiniteGroundSpanForCamera(camera, textureScaleMeters = DEFAULT_MOVEMENT_CUE.textureScaleMeters) {
  const inverseProjection = camera?.projectionMatrixInverse?.elements;
  const fallbackFar = finitePositiveNumber(camera?.far, 100);
  let farCornerDistance = fallbackFar;
  if (inverseProjection?.length >= 16) {
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        const projectedX = inverseProjection[0] * x
          + inverseProjection[4] * y
          + inverseProjection[8]
          + inverseProjection[12];
        const projectedY = inverseProjection[1] * x
          + inverseProjection[5] * y
          + inverseProjection[9]
          + inverseProjection[13];
        const projectedZ = inverseProjection[2] * x
          + inverseProjection[6] * y
          + inverseProjection[10]
          + inverseProjection[14];
        const projectedW = inverseProjection[3] * x
          + inverseProjection[7] * y
          + inverseProjection[11]
          + inverseProjection[15];
        if (!Number.isFinite(projectedW) || Math.abs(projectedW) < Number.EPSILON) continue;
        const distance = Math.hypot(
          projectedX / projectedW,
          projectedY / projectedW,
          projectedZ / projectedW,
        );
        if (Number.isFinite(distance)) farCornerDistance = Math.max(farCornerDistance, distance);
      }
    }
  }
  const requiredSpan = Math.max(
    INFINITE_GROUND_MIN_TILE_SIZE_METERS,
    farCornerDistance * 2 * INFINITE_GROUND_FAR_CORNER_MARGIN,
  );
  const powerOfTwoSpan = 2 ** Math.ceil(Math.log2(requiredSpan));
  return textureAlignedGroundSpan(
    Number.isFinite(powerOfTwoSpan) ? powerOfTwoSpan : requiredSpan,
    textureScaleMeters,
  );
}

function infiniteGroundCuePositionFromConfig(config, cameraPosition) {
  if (config.coverage !== "infinite") return [...config.position];

  const cameraX = finiteCoordinate(cameraPosition?.x ?? cameraPosition?.[0], config.position[0]);
  const cameraZ = finiteCoordinate(cameraPosition?.z ?? cameraPosition?.[2], config.position[2]);
  const deltaX = cameraX - config.position[0];
  const deltaZ = cameraZ - config.position[2];
  const cosine = Math.cos(config.rotationY);
  const sine = Math.sin(config.rotationY);
  const localX = cosine * deltaX - sine * deltaZ;
  const localZ = sine * deltaX + cosine * deltaZ;
  const texturePeriodsPerStep = Math.max(
    1,
    Math.round(INFINITE_GROUND_RECENTER_TARGET_METERS / config.textureScaleMeters),
  );
  const recenterStep = texturePeriodsPerStep * config.textureScaleMeters;
  const snappedLocalX = Math.round(localX / recenterStep) * recenterStep;
  const snappedLocalZ = Math.round(localZ / recenterStep) * recenterStep;
  return [
    finiteCoordinate(
      config.position[0] + cosine * snappedLocalX + sine * snappedLocalZ,
      config.position[0],
    ),
    config.position[1],
    finiteCoordinate(
      config.position[2] - sine * snappedLocalX + cosine * snappedLocalZ,
      config.position[2],
    ),
  ];
}

export function createGroundMovementCue(value, {
  renderer,
  textureUrl = null,
  textureLoader = null,
  onTextureError = null,
} = {}) {
  let config = normalizeGroundMovementCue(value);
  if (!config.enabled) return null;

  const fallbackTexture = createSandCanvasTexture(renderer);
  let geometry = new THREE.BoxGeometry(1, 1, 1);
  let geometrySignature = "bounded";
  const material = new THREE.MeshStandardMaterial({
    color: 0xc7c2b5,
    map: fallbackTexture,
    metalness: 0,
    roughness: 0.96,
    transparent: true,
    opacity: config.opacity,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "storyvr-ground-movement-cue";
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.storyvrGroundMovementCue = true;

  let disposed = false;
  let activeTexture = fallbackTexture;
  let generatedTexture = null;
  let requestedTextureUrl = "";
  let textureLoadRevision = 0;
  let infiniteGroundSpan = textureAlignedGroundSpan(
    INFINITE_GROUND_MIN_TILE_SIZE_METERS,
    config.textureScaleMeters,
  );
  const cameraWorldPosition = new THREE.Vector3();

  mesh.onBeforeRender = (_activeRenderer, _scene, renderCamera) => {
    if (disposed || config.coverage !== "infinite") return;
    if (!renderCamera?.matrixWorld) return;
    const requiredSpan = infiniteGroundSpanForCamera(renderCamera, config.textureScaleMeters);
    let matrixChanged = false;
    if (requiredSpan !== infiniteGroundSpan) {
      infiniteGroundSpan = requiredSpan;
      applyRenderedGroundDimensions();
      matrixChanged = true;
    }
    // Three's WebXR eye cameras are unparented, but WebXRManager precomposes
    // their matrixWorld with the authored camera rig. Reading that matrix
    // directly preserves Reader alignment and locomotion; getWorldPosition()
    // would recompute the unparented eye matrix and discard the rig transform.
    cameraWorldPosition.setFromMatrixPosition(renderCamera.matrixWorld);
    const nextPosition = infiniteGroundCuePositionFromConfig(config, cameraWorldPosition);
    if (
      mesh.position.x !== nextPosition[0]
      || mesh.position.y !== nextPosition[1]
      || mesh.position.z !== nextPosition[2]
    ) {
      mesh.position.fromArray(nextPosition);
      matrixChanged = true;
    }
    if (matrixChanged) mesh.updateMatrixWorld(true);
  };

  function applyTextureRepeat(texture) {
    if (config.coverage === "infinite") {
      texture.repeat.set(1, 1);
      texture.needsUpdate = true;
      return;
    }
    const widthMeters = renderedGroundWidth(config, infiniteGroundSpan);
    const depthMeters = renderedGroundDepth(config, infiniteGroundSpan);
    texture.repeat.set(
      widthMeters / config.textureScaleMeters,
      depthMeters / config.textureScaleMeters,
    );
    texture.needsUpdate = true;
  }

  function applyRenderedGroundDimensions() {
    const nextGeometrySignature = config.coverage === "infinite"
      ? `infinite:${infiniteGroundSpan}:${config.textureScaleMeters}:${config.widthMeters}:${config.depthMeters}`
      : "bounded";
    if (geometrySignature !== nextGeometrySignature) {
      const nextGeometry = config.coverage === "infinite"
        ? createInfiniteGroundGeometry(
          infiniteGroundSpan,
          config.textureScaleMeters,
          config.widthMeters,
          config.depthMeters,
        )
        : new THREE.BoxGeometry(1, 1, 1);
      const previousGeometry = geometry;
      geometry = nextGeometry;
      geometrySignature = nextGeometrySignature;
      mesh.geometry = nextGeometry;
      previousGeometry.dispose();
    }
    mesh.scale.set(
      renderedGroundWidth(config, infiniteGroundSpan),
      config.thicknessMeters,
      renderedGroundDepth(config, infiniteGroundSpan),
    );
    applyTextureRepeat(activeTexture);
  }

  function useFallbackTexture() {
    if (generatedTexture) {
      generatedTexture.dispose();
      generatedTexture = null;
    }
    activeTexture = fallbackTexture;
    material.map = fallbackTexture;
    material.color.setHex(0xc7c2b5);
    material.needsUpdate = true;
    applyTextureRepeat(fallbackTexture);
  }

  function installGeneratedTexture(texture, revision) {
    if (disposed || revision !== textureLoadRevision) {
      texture.dispose();
      return;
    }
    configureGroundTexture(texture, renderer, "storyvr-generated-matching-ground");
    if (generatedTexture && generatedTexture !== texture) generatedTexture.dispose();
    generatedTexture = texture;
    activeTexture = texture;
    material.map = texture;
    material.color.setHex(0xffffff);
    material.needsUpdate = true;
    applyTextureRepeat(texture);
  }

  function loadMatchingTexture(nextTextureUrl) {
    const normalizedUrl = config.texture ? String(nextTextureUrl || "").trim() : "";
    if (normalizedUrl === requestedTextureUrl) return;
    requestedTextureUrl = normalizedUrl;
    const revision = ++textureLoadRevision;
    useFallbackTexture();
    if (!normalizedUrl) return;

    const loader = textureLoader || new THREE.TextureLoader();
    try {
      loader.load(
        normalizedUrl,
        (texture) => installGeneratedTexture(texture, revision),
        undefined,
        (error) => {
          if (disposed || revision !== textureLoadRevision) return;
          useFallbackTexture();
          if (typeof onTextureError === "function") onTextureError(error);
        },
      );
    } catch (error) {
      if (!disposed && revision === textureLoadRevision) {
        useFallbackTexture();
        if (typeof onTextureError === "function") onTextureError(error);
      }
    }
  }

  const controller = {
    mesh,
    get geometry() {
      return geometry;
    },
    material,
    get texture() {
      return activeTexture;
    },
    get config() {
      return config;
    },
    update(nextValue, options = {}) {
      if (disposed) return config;
      config = normalizeGroundMovementCue(nextValue);
      mesh.visible = config.enabled;
      mesh.position.fromArray(config.position);
      mesh.rotation.set(0, config.rotationY, 0);
      infiniteGroundSpan = textureAlignedGroundSpan(
        Math.max(INFINITE_GROUND_MIN_TILE_SIZE_METERS, infiniteGroundSpan),
        config.textureScaleMeters,
      );
      applyRenderedGroundDimensions();
      mesh.frustumCulled = config.coverage !== "infinite";
      material.opacity = config.opacity;
      mesh.userData.movementCue = {
        ...config,
        position: [...config.position],
        texture: config.texture ? { ...config.texture } : null,
      };
      const nextTextureUrl = Object.hasOwn(options, "textureUrl")
        ? options.textureUrl
        : requestedTextureUrl;
      loadMatchingTexture(nextTextureUrl);
      return config;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      textureLoadRevision += 1;
      mesh.onBeforeRender = () => {};
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      generatedTexture?.dispose();
      generatedTexture = null;
      fallbackTexture.dispose();
    },
  };

  controller.update(config, { textureUrl });
  return controller;
}

function renderedGroundWidth(config, infiniteGroundSpan) {
  return config.coverage === "infinite"
    ? infiniteGroundSpan
    : config.widthMeters;
}

function renderedGroundDepth(config, infiniteGroundSpan) {
  return config.coverage === "infinite"
    ? infiniteGroundSpan
    : config.depthMeters;
}

function textureAlignedGroundSpan(value, textureScaleMeters) {
  const span = finitePositiveNumber(value, INFINITE_GROUND_MIN_TILE_SIZE_METERS);
  const textureScale = boundedNumber(
    textureScaleMeters,
    DEFAULT_MOVEMENT_CUE.textureScaleMeters,
    0.02,
    5,
  );
  // Centered box UVs place the origin at half the repeat count. Keeping that
  // count even prevents the world texture phase from shifting by half a period
  // when the camera requires a larger render span.
  const evenTexturePeriods = Math.ceil(span / textureScale / 2) * 2;
  const aligned = evenTexturePeriods * textureScale;
  return Number.isFinite(aligned) ? aligned : span;
}

/**
 * Builds a single draw-call surface whose cells grow geometrically away from
 * the viewer. Near cells retain small, precise UV ranges while outer cells can
 * cover an arbitrarily distant camera far plane without creating millions of
 * quads. Cell-local wrapped UV origins keep every seam on the same texture
 * phase, so the generated ground remains fixed in authored world space.
 */
function createInfiniteGroundGeometry(
  spanMeters,
  textureScaleMeters,
  boundedWidthMeters,
  boundedDepthMeters,
) {
  const span = finitePositiveNumber(spanMeters, INFINITE_GROUND_MIN_TILE_SIZE_METERS);
  const textureScale = boundedNumber(
    textureScaleMeters,
    DEFAULT_MOVEMENT_CUE.textureScaleMeters,
    0.02,
    5,
  );
  const axis = infiniteGroundAxisCoordinates(span);
  // BoxGeometry anchors its top-face texture at the bounded patch's -X/-Z
  // corner. Retaining those half-dimension offsets keeps the terrain under the
  // authored origin unchanged when an existing bounded cue becomes infinite.
  const uOriginOffset = finitePositiveNumber(boundedWidthMeters, DEFAULT_MOVEMENT_CUE.widthMeters) / 2;
  const vOriginOffset = finitePositiveNumber(boundedDepthMeters, DEFAULT_MOVEMENT_CUE.depthMeters) / 2;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let zIndex = 0; zIndex < axis.length - 1; zIndex += 1) {
    const z0 = axis[zIndex];
    const z1 = axis[zIndex + 1];
    // Match BoxGeometry's top-face orientation: U increases with X while V
    // decreases with Z, preserving existing generated-ground alignment.
    const [v1, v0] = wrappedTextureCoordinateRange(-z1, -z0, textureScale, vOriginOffset);
    for (let xIndex = 0; xIndex < axis.length - 1; xIndex += 1) {
      const x0 = axis[xIndex];
      const x1 = axis[xIndex + 1];
      const [u0, u1] = wrappedTextureCoordinateRange(x0, x1, textureScale, uOriginOffset);
      const firstVertex = positions.length / 3;
      positions.push(
        x0 / span, 0.5, z0 / span,
        x0 / span, 0.5, z1 / span,
        x1 / span, 0.5, z1 / span,
        x1 / span, 0.5, z0 / span,
      );
      normals.push(
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
      );
      uvs.push(u0, v0, u0, v1, u1, v1, u1, v0);
      indices.push(
        firstVertex, firstVertex + 1, firstVertex + 2,
        firstVertex, firstVertex + 2, firstVertex + 3,
      );
    }
  }

  const nextGeometry = new THREE.BufferGeometry();
  nextGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  nextGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  nextGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  nextGeometry.setIndex(indices);
  nextGeometry.computeBoundingBox();
  nextGeometry.computeBoundingSphere();
  nextGeometry.userData.storyvrInfiniteGround = true;
  nextGeometry.userData.axisCellCount = axis.length - 1;
  return nextGeometry;
}

function infiniteGroundAxisCoordinates(spanMeters) {
  const halfSpan = spanMeters / 2;
  const positive = [0];
  let coordinate = Math.min(INFINITE_GROUND_CENTER_CELL_SIZE_METERS, halfSpan);
  while (coordinate < halfSpan) {
    positive.push(coordinate);
    coordinate *= 2;
  }
  if (positive.at(-1) !== halfSpan) positive.push(halfSpan);
  return [
    ...positive.slice(1).reverse().map((value) => -value),
    ...positive,
  ];
}

function wrappedTextureCoordinateRange(
  startMeters,
  endMeters,
  textureScaleMeters,
  originOffsetMeters = 0,
) {
  const startPeriods = (startMeters + originOffsetMeters) / textureScaleMeters;
  const startPhase = ((startPeriods % 1) + 1) % 1;
  return [startPhase, startPhase + (endMeters - startMeters) / textureScaleMeters];
}

function finiteCoordinate(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finitePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function createSandCanvasTexture(renderer) {
  const canvas = document.createElement("canvas");
  canvas.width = SAND_TEXTURE_SIZE;
  canvas.height = SAND_TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the StoryVR ground movement-cue texture.");

  drawSandTexture(context, SAND_TEXTURE_SIZE, SAND_TEXTURE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  configureGroundTexture(texture, renderer, "storyvr-pale-beach-sand");
  return texture;
}

function configureGroundTexture(texture, renderer, name) {
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(8, Math.max(1, renderer?.capabilities?.getMaxAnisotropy?.() || 1));
  texture.needsUpdate = true;
}

function normalizeGeneratedGroundTexture(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const publicPath = normalizedText(value.publicPath);
  if (value.role !== "ground-texture" || !publicPath) return null;
  const localPath = normalizedText(value.localPath);
  const localUrl = normalizedText(value.localUrl);
  const entryPath = normalizedText(value.entryPath)
    || publicPath.replace(/^environment-enhancement\//, "");
  const sha256 = normalizedText(value.sha256).toLowerCase();
  const bytes = Number(value.bytes);
  return {
    role: "ground-texture",
    ...(localPath ? { localPath } : {}),
    ...(localUrl ? { localUrl } : {}),
    publicPath,
    entryPath,
    format: "png",
    mediaType: "image/png",
    sha256: /^[a-f0-9]{64}$/.test(sha256) ? sha256 : "",
    bytes: Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : 0,
    ...(value.generation && typeof value.generation === "object" && !Array.isArray(value.generation)
      ? { generation: { ...value.generation } }
      : {}),
  };
}

function normalizedText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function drawSandTexture(context, width, height) {
  const random = seededRandom(SAND_TEXTURE_SEED);
  context.fillStyle = "#d0c8b8";
  context.fillRect(0, 0, width, height);

  context.lineCap = "round";
  for (let row = -20; row < height + 24; row += 29) {
    context.beginPath();
    for (let x = -8; x <= width + 8; x += 4) {
      const y = row
        + Math.sin((x + row * 0.41) * 0.047) * 2.4
        + Math.sin((x - row) * 0.018) * 1.2;
      if (x === -8) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = row % 58 === 0 ? "rgba(246, 241, 230, 0.32)" : "rgba(126, 112, 91, 0.2)";
    context.lineWidth = row % 58 === 0 ? 2.8 : 1.5;
    context.stroke();
  }

  for (let index = 0; index < 760; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const radius = 0.35 + random() * 1.25;
    const lightGrain = random() > 0.48;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = lightGrain
      ? `rgba(246, 241, 230, ${0.12 + random() * 0.28})`
      : `rgba(105, 84, 55, ${0.08 + random() * 0.2})`;
    context.fill();
  }

  for (let index = 0; index < 18; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const radiusX = 5 + random() * 11;
    const radiusY = 1.8 + random() * 4.2;
    context.save();
    context.translate(x, y);
    context.rotate(random() * Math.PI);
    context.beginPath();
    context.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.fillStyle = random() > 0.25 ? "rgba(89, 78, 61, 0.42)" : "rgba(230, 225, 214, 0.5)";
    context.fill();
    context.restore();
  }

  for (let index = 0; index < 7; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const length = 32 + random() * 66;
    context.save();
    context.translate(x, y);
    context.rotate(random() * Math.PI * 2);
    context.beginPath();
    context.moveTo(-length * 0.5, 0);
    context.bezierCurveTo(
      -length * 0.18,
      -5 - random() * 8,
      length * 0.16,
      4 + random() * 9,
      length * 0.5,
      0,
    );
    context.strokeStyle = "rgba(67, 59, 48, 0.48)";
    context.lineWidth = 2.4 + random() * 2.8;
    context.stroke();
    context.restore();
  }
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function boundedNumber(value, fallback, minimum, maximum) {
  if (value === null || value === "" || typeof value === "boolean") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}
