import * as THREE from "three";

const DEFAULT_MOVEMENT_CUE = Object.freeze({
  enabled: false,
  style: "sand",
  texture: null,
  rotationY: 0,
  position: Object.freeze([0, 0.004, -0.4]),
  widthMeters: 2,
  depthMeters: 1.5,
  thicknessMeters: 0.008,
  textureScaleMeters: 0.2,
  opacity: 0.55,
});

const SAND_TEXTURE_SIZE = 512;
const SAND_TEXTURE_SEED = 0x51a7d;

export function normalizeGroundMovementCue(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const position = Array.isArray(source.position) ? source.position : DEFAULT_MOVEMENT_CUE.position;
  const texture = normalizeGeneratedGroundTexture(source.texture);
  return {
    enabled: source.enabled === true,
    style: texture ? "generated" : "sand",
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

export function createGroundMovementCue(value, {
  renderer,
  textureUrl = null,
  textureLoader = null,
  onTextureError = null,
} = {}) {
  let config = normalizeGroundMovementCue(value);
  if (!config.enabled) return null;

  const fallbackTexture = createSandCanvasTexture(renderer);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
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

  function applyTextureRepeat(texture) {
    texture.repeat.set(
      config.widthMeters / config.textureScaleMeters,
      config.depthMeters / config.textureScaleMeters,
    );
    texture.needsUpdate = true;
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
    geometry,
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
      mesh.scale.set(config.widthMeters, config.thicknessMeters, config.depthMeters);
      applyTextureRepeat(activeTexture);
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
