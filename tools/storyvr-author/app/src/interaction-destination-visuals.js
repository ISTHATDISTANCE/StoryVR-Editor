import * as THREE from "three";
import { clone as cloneSkinnedObject } from "three/addons/utils/SkeletonUtils.js";

const COLORS = { selected: 0x6ed8c2, idle: 0x6ed8c2, outside: 0xb12e4b };
const NO_RAYCAST = () => {};
const GHOST_OPACITY = 0.32;

function vector(value, fallback = [0, 0, 0]) {
  return value?.isVector3 ? value.clone() : new THREE.Vector3().fromArray(Array.isArray(value) ? value : fallback);
}

function transformMatrix(transform) {
  const quaternion = transform?.quaternion?.isQuaternion
    ? transform.quaternion.clone()
    : new THREE.Quaternion().fromArray(transform?.quaternion || [0, 0, 0, 1]);
  return new THREE.Matrix4().compose(vector(transform?.position), quaternion.normalize(), vector(transform?.scale, [1, 1, 1]));
}

function applyWorldTransform(object, transform) {
  const matrix = transformMatrix(transform);
  if (object.parent) {
    object.parent.updateWorldMatrix(true, false);
    matrix.premultiply(object.parent.matrixWorld.clone().invert());
  }
  matrix.decompose(object.position, object.quaternion, object.scale);
  object.updateWorldMatrix(true, true);
}

function requiredTransformComponents(target = {}) {
  const available = target.oneHandGrabbable === undefined && target.twoHandScalable === undefined
    ? ["position", "rotation", "scale"]
    : [target.oneHandGrabbable === true ? "position" : null, target.oneHandGrabbable === true ? "rotation" : null, target.twoHandScalable === true ? "scale" : null].filter(Boolean);
  const requested = Array.isArray(target.triggerComponents)
    ? target.triggerComponents.map((component) => String(component || "").trim().toLowerCase()).filter((component) => available.includes(component))
    : [];
  return new Set(requested.length ? requested : available);
}

function sourceClonePairs(source, clone, pairs = []) {
  if (!source || !clone) return pairs;
  pairs.push({ source, clone });
  for (let index = 0; index < source.children.length; index += 1) {
    sourceClonePairs(source.children[index], clone.children[index], pairs);
  }
  return pairs;
}

function syncDirectDestinationSource(record) {
  if (!record.sourceObject) return;
  const required = requiredTransformComponents(record.target);
  // The caller gives the ghost the same coordinate parent as the live source.
  // Keep authored/dragged channels exactly intact; the other local channels follow.
  if (!required.has("position")) record.object.position.copy(record.sourceObject.position);
  if (!required.has("rotation")) record.object.quaternion.copy(record.sourceObject.quaternion);
  if (!required.has("scale")) record.object.scale.copy(record.sourceObject.scale);
  for (const { source, clone } of record.sourceClonePairs) {
    if (clone !== record.object) {
      clone.position.copy(source.position);
      clone.quaternion.copy(source.quaternion);
      clone.scale.copy(source.scale);
      clone.matrixAutoUpdate = source.matrixAutoUpdate;
      clone.matrix.copy(source.matrix);
      clone.matrixWorldAutoUpdate = true;
      clone.visible = !(source.isCamera || source.isLight || source.isAudio) && source.visible !== false;
    }
    if (Array.isArray(source.morphTargetInfluences)) {
      if (!Array.isArray(clone.morphTargetInfluences) || clone.morphTargetInfluences === source.morphTargetInfluences
        || clone.morphTargetInfluences.length !== source.morphTargetInfluences.length) {
        clone.morphTargetInfluences = source.morphTargetInfluences.slice();
      } else {
        for (let index = 0; index < source.morphTargetInfluences.length; index += 1) {
          clone.morphTargetInfluences[index] = source.morphTargetInfluences[index];
        }
      }
    }
    // Pose changes invalidate cached skinned bounds; compute only when framing
    // requests them. Ghost meshes already skip frustum culling during playback.
    if (clone.isSkinnedMesh) { clone.boundingBox = null; clone.boundingSphere = null; }
  }
}

function ghostMaterial(source, node) {
  let material = source?.isShaderMaterial ? null : source?.clone?.();
  material ||= node?.isPoints ? new THREE.PointsMaterial({ size: 0.035 })
    : node?.isLine ? new THREE.LineBasicMaterial()
      : new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  // Match the WebXR manipulation ghost: retain the model's textures and use
  // translucent additive light, rather than painting a solid target silhouette.
  material.blending = THREE.AdditiveBlending;
  material.toneMapped = false;
  material.fog = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  material.userData.storyvrInteractionDestinationGhost = true;
  const sourceOpacity = Number.isFinite(Number(source?.opacity)) ? Number(source.opacity) : 1;
  const glow = material.color?.clone?.() || new THREE.Color(COLORS.selected);
  glow.lerp(new THREE.Color(COLORS.selected), 0.28);
  material.userData.destinationGhostStyle = {
    color: material.color?.getHex?.(),
    glow: glow.getHex(),
    emissiveIntensity: Math.max(Number(material.emissiveIntensity) || 0, 0.38),
    opacity: THREE.MathUtils.clamp(sourceOpacity, 0, 1) * GHOST_OPACITY,
  };
  return material;
}

function makeRange() {
  const group = new THREE.Group();
  group.name = "Allowed movement range";
  group.matrixAutoUpdate = false;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x4a9d88, transparent: true, opacity: 0.055, depthWrite: false, side: THREE.DoubleSide }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x2e776c, transparent: true, opacity: 0.6, depthWrite: false, depthTest: false }));
  group.add(fill, edges);
  for (const child of group.children) { child.raycast = NO_RAYCAST; child.renderOrder = 30; }
  return { group, fill, edges };
}

function makeTolerance() {
  const group = new THREE.Group();
  group.name = "Acceptable position tolerance";
  group.matrixAutoUpdate = false;
  const geometry = new THREE.SphereGeometry(1, 32, 20);
  const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xc75f1f, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
  group.add(fill);
  const rings = [];
  for (let plane = 0; plane < 3; plane += 1) {
    const points = Array.from({ length: 64 }, (_, i) => {
      const a = i / 64 * Math.PI * 2;
      return plane === 0 ? new THREE.Vector3(Math.cos(a), Math.sin(a), 0)
        : plane === 1 ? new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
          : new THREE.Vector3(0, Math.cos(a), Math.sin(a));
    });
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xc75f1f, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false }));
    rings.push(ring);
    group.add(ring);
  }
  for (const child of group.children) { child.raycast = NO_RAYCAST; child.renderOrder = 34; }
  return { group, fill, rings };
}

/** Add object and overlay separately to the viewer scene; attach the gizmo to object. */
export function createDirectDestinationVisual({ sourceObject = null, target = {}, selected = false, label = "Object", positionTolerance = 0.15, outsideRange = false } = {}) {
  sourceObject?.updateWorldMatrix(true, true);
  const sourceSkeletons = new Set();
  sourceObject?.traverse?.((node) => { if (node.skeleton) sourceSkeletons.add(node.skeleton); });
  let object;
  try { object = sourceObject ? cloneSkinnedObject(sourceObject) : new THREE.Group(); }
  catch { object = sourceObject?.clone?.(true) || new THREE.Group(); }
  const record = {
    object, sourceObject, overlay: new THREE.Group(), materials: [], ownedGeometries: [], skeletons: new Set(),
    sourceClonePairs: sourceClonePairs(sourceObject, object),
    target, selected, objectLabel: label, positionTolerance, outsideRange, sourceParentMatrix: sourceObject?.parent?.matrixWorld.clone() || new THREE.Matrix4(),
  };
  let renderables = 0;
  object.name = `StoryVR target · ${label}`;
  object.visible = true;
  object.traverse((node) => {
    node.userData = { ...node.userData, storyvrInteractionDestinationGhost: true };
    if (node.isCamera || node.isLight || node.isAudio) { node.visible = false; return; }
    if (node.isSkinnedMesh && node.skeleton && !sourceSkeletons.has(node.skeleton)) record.skeletons.add(node.skeleton);
    if (!node.isMesh && !node.isLine && !node.isPoints) return;
    const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material];
    const materials = sourceMaterials.map((material) => ghostMaterial(material, node));
    node.material = Array.isArray(node.material) ? materials : materials[0];
    record.materials.push(...materials);
    node.castShadow = false;
    node.receiveShadow = false;
    node.frustumCulled = false;
    if (node.isSkinnedMesh) {
      node.boundingBox = null;
      node.boundingSphere = null;
    }
    node.renderOrder = 35;
    renderables += 1;
  });
  if (!renderables) {
    const geometry = new THREE.BoxGeometry(0.42, 0.42, 0.42);
    const material = ghostMaterial();
    object.add(new THREE.Mesh(geometry, material));
    record.materials.push(material);
    record.ownedGeometries.push(geometry);
  }
  if (sourceObject) {
    sourceObject.matrixWorld.decompose(object.position, object.quaternion, object.scale);
    object.matrixAutoUpdate = true;
    object.updateWorldMatrix(true, true);
  }
  record.overlay.name = `StoryVR target guides · ${label}`;
  record.range = makeRange();
  record.tolerance = makeTolerance();
  record.overlay.add(record.range.group, record.tolerance.group);
  updateDirectDestinationVisual(record);
  return record;
}

/** Omit worldTransform while dragging; followSource updates only unchecked channels and model pose. */
export function updateDirectDestinationVisual(record, options = {}) {
  if (!record || record.disposed) return;
  for (const key of ["target", "selected", "positionTolerance", "outsideRange", "sourceParentMatrix"]) {
    if (options[key] !== undefined) record[key] = options[key];
  }
  if (options.label !== undefined) record.objectLabel = options.label;
  if (options.worldTransform) applyWorldTransform(record.object, options.worldTransform);
  if (options.followSource === true) syncDirectDestinationSource(record);
  record.object.parent?.updateWorldMatrix(true, false);
  record.object.updateMatrixWorld(true);
  const accent = record.outsideRange ? COLORS.outside : record.selected ? COLORS.selected : COLORS.idle;
  for (const material of record.materials) {
    const style = material.userData.destinationGhostStyle;
    material.color?.setHex(record.outsideRange ? COLORS.outside : style.color ?? COLORS.selected);
    material.emissive?.setHex(record.outsideRange ? COLORS.outside : style.glow);
    if (material.emissive) material.emissiveIntensity = style.emissiveIntensity;
    material.opacity = style.opacity * (record.selected ? 1 : 0.65);
  }
  const position = record.object.getWorldPosition(new THREE.Vector3());
  const parentMatrix = record.sourceParentMatrix || new THREE.Matrix4();
  const target = record.target || {};
  const usesPosition = Array.isArray(target.triggerComponents) && target.triggerComponents.length
    ? target.triggerComponents.includes("position")
    : target.oneHandGrabbable !== false;
  const range = target.constraints?.position;
  const validRange = range && [range.min, range.max].every((values) => Array.isArray(values) && values.length >= 3 && values.every(Number.isFinite));
  record.range.group.visible = Boolean(record.selected && usesPosition && validRange);
  if (validRange) {
    const min = vector(range.min).min(vector(range.max));
    const max = vector(range.max).max(vector(range.min));
    const center = min.clone().add(max).multiplyScalar(0.5);
    const size = max.sub(min).max(new THREE.Vector3(0.012, 0.012, 0.012));
    record.range.group.matrix.copy(parentMatrix);
    for (const child of record.range.group.children) { child.position.copy(center); child.scale.copy(size); }
  }
  const radius = Number(record.positionTolerance);
  record.tolerance.group.visible = Boolean(record.selected && usesPosition && Number.isFinite(radius) && radius > 0);
  if (record.tolerance.group.visible) {
    // Runtime compares local positions. Carry the parent's scale/rotation into this
    // sphere, but never the target object's own scale, so the aid matches that test.
    const localPosition = position.clone().applyMatrix4(parentMatrix.clone().invert());
    record.tolerance.group.matrix.copy(parentMatrix).multiply(new THREE.Matrix4().makeTranslation(...localPosition.toArray())).scale(new THREE.Vector3(radius, radius, radius));
    record.tolerance.fill.material.color.setHex(accent);
    for (const ring of record.tolerance.rings) ring.material.color.setHex(accent);
  }
  record.overlay.updateMatrixWorld(true);
}

/** Bounds exclude tolerance by default to make framing predictable. */
export function directDestinationVisualBounds(record, { includeOriginal = true, includeRange = false } = {}) {
  const bounds = new THREE.Box3();
  if (!record || record.disposed) return bounds;
  record.object.parent?.updateWorldMatrix(true, false);
  record.object.updateMatrixWorld(true);
  bounds.setFromObject(record.object);
  if (includeOriginal && record.sourceObject) {
    record.sourceObject.updateWorldMatrix(true, true);
    bounds.union(new THREE.Box3().setFromObject(record.sourceObject));
  }
  if (includeRange && record.range.group.visible) bounds.union(new THREE.Box3().setFromObject(record.range.group));
  return bounds;
}

/** Shared source geometry and source textures are intentionally left intact. */
export function disposeDirectDestinationVisual(record) {
  if (!record || record.disposed) return;
  record.disposed = true;
  record.sourceClonePairs = [];
  record.object.removeFromParent();
  record.overlay.removeFromParent();
  for (const material of record.materials) material.dispose();
  for (const geometry of record.ownedGeometries) geometry.dispose();
  for (const skeleton of record.skeletons) skeleton.dispose();
  const helperGeometries = new Set();
  const helperMaterials = new Set();
  record.overlay.traverse((node) => {
    // Sprite geometry is shared internally by Three.js.
    if (node.geometry && !node.isSprite) helperGeometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) helperMaterials.add(material);
  });
  for (const geometry of helperGeometries) geometry.dispose();
  for (const material of helperMaterials) material.dispose();
}
