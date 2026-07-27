const POINT_CLOUD_EFFECT_SCHEMA = "storyvr-pointcloud-composite-effect/v1";
const POINT_CLOUD_RECONSTRUCTION_KIND = "fixed-pointcloud-progressive-opacity-reveal";
const MAX_POINT_CLOUD_EFFECTS = 8;
const MAX_POINT_CLOUD_GROUPS = 64;
const MAX_POINT_CLOUD_POINTS = 500_000;
const MAX_POINT_CLOUD_TEXT_BYTES = 64 * 1024 * 1024;
const parsedPointCloudCache = new Map();

function cleanString(value) {
  return String(value || "").trim();
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function pathBasename(value) {
  const text = cleanString(value).replace(/\\/g, "/");
  if (!text) return "";
  try {
    return decodeURIComponent(new URL(text, "https://storyvr.invalid/").pathname)
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.toLowerCase() || "";
  } catch {
    return text.split("/").filter(Boolean).at(-1)?.toLowerCase() || "";
  }
}

function vector3(value, fallback) {
  const values = Array.isArray(value)
    ? value
    : cleanString(value).split(",").map((item) => item.trim()).filter(Boolean);
  if (values.length !== 3) return [...fallback];
  const normalized = values.map((item) => Number(item));
  return normalized.every(Number.isFinite) ? normalized : [...fallback];
}

function assetForReference(assets, references) {
  const ids = new Set(references.map(cleanString).filter(Boolean));
  const basenames = new Set([...ids].map(pathBasename).filter(Boolean));
  return (assets || []).find((asset) => (
    ids.has(cleanString(asset?.id))
    || ids.has(cleanString(asset?.path))
    || ids.has(cleanString(asset?.url))
    || [asset?.id, asset?.path, asset?.url].some((value) => basenames.has(pathBasename(value)))
  )) || null;
}

function normalizeEmitTimes(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .flatMap((item) => {
      const groupIndex = Number(item?.groupIndex);
      const emitTimeSeconds = Number(item?.emitTimeSeconds);
      if (
        !Number.isInteger(groupIndex)
        || groupIndex < 0
        || groupIndex >= MAX_POINT_CLOUD_GROUPS
        || !Number.isFinite(emitTimeSeconds)
        || emitTimeSeconds < 0
        || seen.has(groupIndex)
      ) return [];
      seen.add(groupIndex);
      return [{
        groupIndex,
        emitTimeSeconds,
        driverNode: cleanString(item?.driverNode) || `cough_driver_${groupIndex}`,
      }];
    })
    .sort((left, right) => left.groupIndex - right.groupIndex);
}

export function normalizeStoryVrPointCloudEffects(value, assets = []) {
  return (Array.isArray(value) ? value : [])
    .slice(0, MAX_POINT_CLOUD_EFFECTS)
    .flatMap((rawEffect, index) => {
      if (
        rawEffect?.schemaVersion !== POINT_CLOUD_EFFECT_SCHEMA
        || rawEffect?.reconstructionContract?.kind !== POINT_CLOUD_RECONSTRUCTION_KIND
        || rawEffect?.scope?.activation !== "explicit-source-ptcloud-link-only"
      ) return [];
      const modelReferences = [
        rawEffect?.model?.localPath,
        rawEffect?.model?.file,
        rawEffect?.model?.assetUrl,
        rawEffect?.model?.finalUrl,
        rawEffect?.model?.reference,
      ];
      const pointCloudReferences = [
        rawEffect?.pointCloud?.localPath,
        rawEffect?.pointCloud?.file,
        rawEffect?.pointCloud?.assetUrl,
        rawEffect?.pointCloud?.finalUrl,
        rawEffect?.pointCloud?.reference,
      ];
      const modelAsset = assetForReference(assets, modelReferences);
      const pointCloudAsset = assetForReference(assets, pointCloudReferences);
      const modelPath = cleanString(modelAsset?.path || rawEffect?.model?.localPath);
      const pointCloudPath = cleanString(pointCloudAsset?.path || rawEffect?.pointCloud?.localPath);
      const pointCloudUrl = cleanString(pointCloudAsset?.url || rawEffect?.pointCloud?.finalUrl || rawEffect?.pointCloud?.assetUrl);
      const emitTimes = normalizeEmitTimes(rawEffect?.reconstructionContract?.emitTimesSeconds);
      const groupCount = clamp(
        Number(rawEffect?.reconstructionContract?.groupCount) || emitTimes.length,
        0,
        MAX_POINT_CLOUD_GROUPS,
      );
      const groupColumnIndex = Number(rawEffect?.pointCloud?.driverGroupColumn?.index);
      if (
        !modelPath
        || (!pointCloudPath && !pointCloudUrl)
        || !groupCount
        || emitTimes.length !== groupCount
      ) return [];
      const sourceTransform = rawEffect?.sourceLink?.transform || {};
      return [{
        id: cleanString(rawEffect?.id) || `pointcloud-effect-${index + 1}`,
        schemaVersion: POINT_CLOUD_EFFECT_SCHEMA,
        captureStatus: cleanString(rawEffect?.captureStatus) || "partial",
        scope: {
          activation: "explicit-source-ptcloud-link-only",
          specialization: cleanString(rawEffect?.scope?.specialization),
          requiredForUnrelatedStories: false,
        },
        modelAssetId: cleanString(modelAsset?.id),
        pointCloudAssetId: cleanString(pointCloudAsset?.id),
        model: {
          path: modelPath,
          url: cleanString(modelAsset?.url || rawEffect?.model?.finalUrl || rawEffect?.model?.assetUrl),
          file: pathBasename(modelPath || rawEffect?.model?.file),
        },
        pointCloud: {
          path: pointCloudPath,
          url: pointCloudUrl,
          file: pathBasename(pointCloudPath || pointCloudUrl || rawEffect?.pointCloud?.file),
          pointCount: Math.max(0, Number(rawEffect?.pointCloud?.summary?.observedPointCount) || 0),
          groupColumnIndex: Number.isInteger(groupColumnIndex) && groupColumnIndex >= 0 ? groupColumnIndex : 4,
          colorColumnIndex: 3,
        },
        modelTransform: {
          position: vector3(sourceTransform.position, [0, 0, 0]),
          rotationDegrees: vector3(sourceTransform.rotation, [0, 0, 0]),
          scale: vector3(sourceTransform.scale, [1, 1, 1]),
        },
        reconstruction: {
          kind: POINT_CLOUD_RECONSTRUCTION_KIND,
          sourcePointMotion: "fixed",
          revealMechanism: "group opacity gates",
          groupCount,
          emitTimes,
          fadeDurationSeconds: Math.max(
            0.01,
            finiteNumber(rawEffect?.reconstructionContract?.fadeDurationSeconds, 1.1),
          ),
        },
        rendering: {
          coordinateMapping: ["x", "z", "-y"],
          whiteThroughColorValue: 5,
          largePointThresholdValue: 7,
          white: [1, 1, 1],
          blue: [48 / 255, 164 / 255, 228 / 255],
          pointSizes: {
            large: 2,
            earlySmall: 0.9,
            lateSmall: 1.2,
          },
          blending: "additive",
        },
      }];
    });
}

export function pointCloudEffectForModelSource(effects, source, assetId = "") {
  const sourceBasename = pathBasename(source);
  const requestedId = cleanString(assetId);
  return (effects || []).find((effect) => (
    (requestedId && effect?.modelAssetId === requestedId)
    || (sourceBasename && [
      effect?.model?.file,
      effect?.model?.path,
      effect?.model?.url,
      effect?.modelAssetId,
    ].some((value) => pathBasename(value) === sourceBasename))
  )) || null;
}

function pcdHeader(text) {
  const dataMatch = /^DATA\s+([^\s]+).*$/im.exec(text);
  if (!dataMatch) throw new Error("PCD is missing its DATA declaration.");
  const headerEnd = text.indexOf("\n", dataMatch.index);
  if (headerEnd < 0) throw new Error("PCD header is incomplete.");
  const headerText = text.slice(0, headerEnd + 1);
  const fields = /^FIELDS\s+(.+)$/im.exec(headerText)?.[1]?.trim().split(/\s+/) || [];
  const points = Number(/^POINTS\s+(\d+)$/im.exec(headerText)?.[1]);
  return {
    dataEncoding: cleanString(dataMatch[1]).toLowerCase(),
    dataOffset: headerEnd + 1,
    fields,
    pointCount: Number.isFinite(points) ? points : null,
  };
}

function pointColorAndSize(colorValue, groupIndex, rendering) {
  const large = colorValue > rendering.largePointThresholdValue;
  const color = colorValue <= rendering.whiteThroughColorValue ? rendering.white : rendering.blue;
  const size = large
    ? rendering.pointSizes.large
    : groupIndex > 5
      ? rendering.pointSizes.lateSmall
      : rendering.pointSizes.earlySmall;
  return { color, size };
}

export function parseStoryVrAsciiPcd(text, effect) {
  const source = String(text || "");
  if (!source || source.length > MAX_POINT_CLOUD_TEXT_BYTES) {
    throw new Error("PCD payload is empty or exceeds the 64 MiB StoryVR limit.");
  }
  const header = pcdHeader(source);
  if (header.dataEncoding !== "ascii") {
    throw new Error(`StoryVR point-cloud effects currently require PCD DATA ascii, not ${header.dataEncoding}.`);
  }
  const normalized = normalizeStoryVrPointCloudEffects([effect])[0] || effect;
  const groupCount = Number(normalized?.reconstruction?.groupCount || normalized?.reconstructionContract?.groupCount);
  const groupColumnIndex = Number(
    normalized?.pointCloud?.groupColumnIndex
    ?? normalized?.pointCloud?.driverGroupColumn?.index
    ?? 4,
  );
  const colorColumnIndex = Number(normalized?.pointCloud?.colorColumnIndex ?? 3);
  if (!Number.isInteger(groupCount) || groupCount <= 0 || groupCount > MAX_POINT_CLOUD_GROUPS) {
    throw new Error("Point-cloud effect has an invalid group count.");
  }
  const rendering = normalized?.rendering || normalizeStoryVrPointCloudEffects([effect])[0]?.rendering;
  if (!rendering) throw new Error("Point-cloud effect has no supported rendering contract.");
  const positions = Array.from({ length: groupCount }, () => []);
  const colors = Array.from({ length: groupCount }, () => []);
  const sizes = Array.from({ length: groupCount }, () => []);
  let observedPointCount = 0;
  const lines = source.slice(header.dataOffset).split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (observedPointCount >= MAX_POINT_CLOUD_POINTS) {
      throw new Error(`PCD exceeds the ${MAX_POINT_CLOUD_POINTS.toLocaleString()} point StoryVR limit.`);
    }
    const values = line.split(/\s+/);
    const groupIndex = Number(values[groupColumnIndex]);
    const x = Number(values[0]);
    const y = Number(values[1]);
    const z = Number(values[2]);
    const colorValue = Number(values[colorColumnIndex]);
    if (
      !Number.isInteger(groupIndex)
      || groupIndex < 0
      || groupIndex >= groupCount
      || ![x, y, z, colorValue].every(Number.isFinite)
    ) continue;
    const style = pointColorAndSize(colorValue, groupIndex, rendering);
    positions[groupIndex].push(x, z, -y);
    colors[groupIndex].push(...style.color);
    sizes[groupIndex].push(style.size);
    observedPointCount += 1;
  }
  if (!observedPointCount) throw new Error("PCD contained no renderable point rows.");
  if (header.pointCount !== null && observedPointCount !== header.pointCount) {
    throw new Error(`PCD declared ${header.pointCount} points but ${observedPointCount} valid rows were decoded.`);
  }
  return {
    pointCount: observedPointCount,
    groupCount,
    layers: positions.map((position, groupIndex) => ({
      groupIndex,
      positions: new Float32Array(position),
      colors: new Float32Array(colors[groupIndex]),
      sizes: new Float32Array(sizes[groupIndex]),
    })),
  };
}

function createPointMaterial(THREE, rendering) {
  return new THREE.ShaderMaterial({
    uniforms: {
      globalOpacity: { value: 0 },
    },
    vertexShader: `
      attribute float pointSize;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = pointSize;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      precision mediump float;
      varying vec3 vColor;
      uniform float globalOpacity;
      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);
        float radius = length(centered);
        if (radius > 0.5) discard;
        float edge = 1.0 - smoothstep(0.28, 0.5, radius);
        gl_FragColor = vec4(vColor, globalOpacity * edge);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: rendering.blending === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: false,
  });
}

export function createStoryVrPointCloudObject(THREE, parsed, effect) {
  const root = new THREE.Group();
  root.name = `storyvr-pointcloud-effect:${effect.id}`;
  root.userData.storyvrPointCloudEffect = {
    id: effect.id,
    groupCount: effect.reconstruction.groupCount,
    fadeDurationSeconds: effect.reconstruction.fadeDurationSeconds,
  };
  const emitTimeByGroup = new Map(
    effect.reconstruction.emitTimes.map((item) => [item.groupIndex, item.emitTimeSeconds]),
  );
  for (const layer of parsed.layers) {
    if (!layer.positions.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(layer.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(layer.colors, 3));
    geometry.setAttribute("pointSize", new THREE.BufferAttribute(layer.sizes, 1));
    geometry.computeBoundingSphere();
    const points = new THREE.Points(geometry, createPointMaterial(THREE, effect.rendering));
    points.name = `cough_layer_${layer.groupIndex}`;
    points.renderOrder = 1000 + layer.groupIndex;
    points.visible = false;
    points.userData.storyvrPointCloudLayer = {
      effectId: effect.id,
      groupIndex: layer.groupIndex,
      driverNode: effect.reconstruction.emitTimes.find((item) => item.groupIndex === layer.groupIndex)?.driverNode
        || `cough_driver_${layer.groupIndex}`,
      emitTimeSeconds: emitTimeByGroup.get(layer.groupIndex) ?? 0,
      fadeDurationSeconds: effect.reconstruction.fadeDurationSeconds,
    };
    root.add(points);
  }
  return root;
}

function applyCapturedModelTransform(THREE, modelScene, effect) {
  if (!modelScene || modelScene.userData?.storyvrPointCloudModelTransformApplied) return;
  const target = modelScene.children?.find((child) => !child.userData?.storyvrPointCloudEffect) || modelScene;
  const transform = effect.modelTransform;
  target.position.fromArray(transform.position);
  target.rotation.set(
    THREE.MathUtils.degToRad(transform.rotationDegrees[0]),
    THREE.MathUtils.degToRad(transform.rotationDegrees[1]),
    THREE.MathUtils.degToRad(transform.rotationDegrees[2]),
  );
  target.scale.fromArray(transform.scale);
  modelScene.userData.storyvrPointCloudModelTransformApplied = {
    effectId: effect.id,
    targetName: target.name || "",
  };
}

function pointCloudLayers(root, effectId = "") {
  const layers = [];
  root?.traverse?.((node) => {
    const metadata = node.userData?.storyvrPointCloudLayer;
    if (metadata && (!effectId || metadata.effectId === effectId)) layers.push(node);
  });
  return layers;
}

function smoothReveal(age, duration) {
  const progress = clamp(age / Math.max(duration, 0.01), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

export function updateStoryVrPointCloudEffects(root, timeSeconds, options = {}) {
  if (!root?.traverse) return 0;
  const time = Number(timeSeconds);
  const preferDrivers = options.preferDrivers !== false;
  let updated = 0;
  for (const layer of pointCloudLayers(root, options.effectId || "")) {
    const metadata = layer.userData.storyvrPointCloudLayer;
    const driver = preferDrivers ? root.getObjectByName?.(metadata.driverNode) : null;
    const driverOpacity = Number(driver?.position?.x) * 100;
    const opacity = Number.isFinite(driverOpacity)
      ? clamp(driverOpacity, 0, 1)
      : Number.isFinite(time)
        ? smoothReveal(time - metadata.emitTimeSeconds, metadata.fadeDurationSeconds)
        : 1;
    if (layer.material?.uniforms?.globalOpacity) {
      layer.material.uniforms.globalOpacity.value = opacity;
    } else if (layer.material) {
      layer.material.opacity = opacity;
    }
    layer.visible = opacity >= 0.0001;
    updated += 1;
  }
  return updated;
}

function parsedPointCloud(url, effect, fetchImpl) {
  const cacheKey = [
    effect.id,
    url,
    effect.reconstruction.groupCount,
    effect.pointCloud.groupColumnIndex,
  ].join("|");
  if (!parsedPointCloudCache.has(cacheKey)) {
    const pending = (async () => {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`Point-cloud request failed with HTTP ${response.status}.`);
      const contentLength = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_POINT_CLOUD_TEXT_BYTES) {
        throw new Error("Point-cloud response exceeds the 64 MiB StoryVR limit.");
      }
      return parseStoryVrAsciiPcd(await response.text(), effect);
    })();
    parsedPointCloudCache.set(cacheKey, pending);
    pending.catch(() => {
      if (parsedPointCloudCache.get(cacheKey) === pending) parsedPointCloudCache.delete(cacheKey);
    });
  }
  return parsedPointCloudCache.get(cacheKey);
}

export async function attachStoryVrPointCloudCompanion({
  THREE,
  gltf,
  effect,
  pointCloudUrl,
  fetchImpl = globalThis.fetch,
}) {
  if (!THREE || !gltf?.scene || !effect || !pointCloudUrl || typeof fetchImpl !== "function") return null;
  const existing = gltf.scene.getObjectByName?.(`storyvr-pointcloud-effect:${effect.id}`);
  if (existing) return existing;
  const parsed = await parsedPointCloud(pointCloudUrl, effect, fetchImpl);
  applyCapturedModelTransform(THREE, gltf.scene, effect);
  const root = createStoryVrPointCloudObject(THREE, parsed, effect);
  gltf.scene.add(root);
  // Start at the source timeline origin. The owning preview/reader seeks this
  // companion to a beat hold or transition window once its playback contract
  // is attached. Initializing at Infinity exposed every cumulative layer while
  // the GLB was still in its unanimated bind pose.
  updateStoryVrPointCloudEffects(root, 0, { preferDrivers: false });
  return root;
}

export function augmentGltfLoaderWithStoryVrPointClouds(loader, options) {
  if (!loader || loader.userData?.storyvrPointCloudAugmented) return loader;
  const originalLoad = loader.load.bind(loader);
  loader.load = (url, onLoad, onProgress, onError) => {
    const effects = typeof options.effects === "function" ? options.effects() : options.effects;
    const effect = pointCloudEffectForModelSource(effects, url, options.assetId || "");
    if (!effect) return originalLoad(url, onLoad, onProgress, onError);
    return originalLoad(
      url,
      (gltf) => {
        const pointCloudUrl = options.pointCloudUrlForEffect?.(effect) || effect.pointCloud.url;
        attachStoryVrPointCloudCompanion({
          THREE: options.THREE,
          gltf,
          effect,
          pointCloudUrl,
          fetchImpl: options.fetchImpl || globalThis.fetch,
        }).then(
          () => onLoad?.(gltf),
          (error) => {
            gltf.userData = {
              ...(gltf.userData || {}),
              storyvrPointCloudError: error.message,
            };
            options.onDiagnostic?.(error, effect);
            onLoad?.(gltf);
          },
        );
      },
      onProgress,
      onError,
    );
  };
  loader.userData = {
    ...(loader.userData || {}),
    storyvrPointCloudAugmented: true,
  };
  return loader;
}
