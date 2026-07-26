import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { VRButton } from "three/addons/webxr/VRButton.js";

const DEFAULT_TRANSFORM = Object.freeze({
  position: [0, 0, 0],
  rotationY: 0,
  scale: 1,
});

const DEFAULT_RENDERING = Object.freeze({
  exposure: 1,
  fogColor: "#dce8e2",
  fogDensity: 0,
  backgroundMode: "asset",
});

const DRACO_DECODER_PATH = "/vendor/draco/";
const MODEL_MEDIA_TYPES = new Set(["model/gltf-binary", "model/gltf+json"]);
const HDR_MEDIA_TYPES = new Set(["image/vnd.radiance", "image/x-hdr"]);
const EXR_MEDIA_TYPES = new Set(["image/x-exr"]);
const MAX_UPLOAD_BYTES = 120 * 1024 * 1024;

const dom = {
  workspace: document.querySelector("#environment-workspace"),
  storyTitle: document.querySelector("#story-title"),
  storySummary: document.querySelector("#story-summary"),
  environmentBrief: document.querySelector("#environment-brief"),
  providerStatus: document.querySelector("#provider-status"),
  lockBadge: document.querySelector("#lock-badge"),
  searchForm: document.querySelector("#search-form"),
  searchQuery: document.querySelector("#search-query"),
  searchButton: document.querySelector("#search-button"),
  searchStatus: document.querySelector("#search-status"),
  resultCount: document.querySelector("#result-count"),
  candidateResults: document.querySelector("#candidate-results"),
  uploadSourceContext: document.querySelector("#upload-source-context"),
  uploadForm: document.querySelector("#upload-form"),
  environmentFile: document.querySelector("#environment-file"),
  uploadButton: document.querySelector("#upload-button"),
  uploadStatus: document.querySelector("#upload-status"),
  viewer: document.querySelector("#environment-viewer"),
  viewerEmpty: document.querySelector("#viewer-empty"),
  viewerLoading: document.querySelector("#viewer-loading"),
  viewerMessage: document.querySelector("#viewer-message"),
  resetCamera: document.querySelector("#reset-camera"),
  xrButtonSlot: document.querySelector("#xr-button-slot"),
  selectionTitle: document.querySelector("#selection-title"),
  selectionSubtitle: document.querySelector("#selection-subtitle"),
  lockButton: document.querySelector("#lock-button"),
  unlockButton: document.querySelector("#unlock-button"),
  tuningForm: document.querySelector("#tuning-form"),
  draftSaveState: document.querySelector("#draft-save-state"),
  inspectorContent: document.querySelector("#inspector-content"),
  toast: document.querySelector("#toast"),
  fatalError: document.querySelector("#fatal-error"),
  fatalErrorMessage: document.querySelector("#fatal-error-message"),
  retryLoad: document.querySelector("#retry-load"),
  positionX: document.querySelector("#position-x"),
  positionY: document.querySelector("#position-y"),
  positionZ: document.querySelector("#position-z"),
  rotationY: document.querySelector("#rotation-y"),
  environmentScale: document.querySelector("#environment-scale"),
  exposure: document.querySelector("#exposure"),
  fogColor: document.querySelector("#fog-color"),
  fogDensity: document.querySelector("#fog-density"),
  backgroundMode: document.querySelector("#background-mode"),
  positionXValue: document.querySelector("#position-x-value"),
  positionYValue: document.querySelector("#position-y-value"),
  positionZValue: document.querySelector("#position-z-value"),
  rotationYValue: document.querySelector("#rotation-y-value"),
  environmentScaleValue: document.querySelector("#environment-scale-value"),
  exposureValue: document.querySelector("#exposure-value"),
  fogDensityValue: document.querySelector("#fog-density-value"),
};

const api = {
  get(path) {
    return request(path, { method: "GET" });
  },
  post(path, body = {}) {
    return request(path, { method: "POST", body });
  },
  patch(path, body = {}) {
    return request(path, { method: "PATCH", body });
  },
  upload(path, file) {
    return request(path, {
      method: "POST",
      rawBody: file,
      contentType: file.type || "application/octet-stream",
    });
  },
};

const ui = {
  serverState: {
    story: null,
    brief: null,
    selection: null,
    locked: false,
    providerStatus: null,
  },
  candidates: [],
  activeCandidateId: null,
  searchBusy: false,
  operationBusy: false,
  draft: {
    transform: cloneValue(DEFAULT_TRANSFORM),
    rendering: cloneValue(DEFAULT_RENDERING),
  },
  draftTimer: null,
  draftRevision: 0,
  draftDirty: false,
  toastTimer: null,
};

const preview = createPersistentPreview();

bindEvents();
loadState();

async function request(path, options = {}) {
  const init = {
    method: options.method || "GET",
    headers: { accept: "application/json" },
  };
  if (Object.hasOwn(options, "body")) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  } else if (Object.hasOwn(options, "rawBody")) {
    init.headers["content-type"] = options.contentType || "application/octet-stream";
    init.body = options.rawBody;
  }
  const response = await fetch(path, init);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : { error: await response.text().catch(() => "") };
  if (!response.ok) {
    const error = new Error(payload.error || payload.message || `${response.status} ${response.statusText}`);
    error.status = response.status;
    error.diagnostics = payload.diagnostics || [];
    throw error;
  }
  return payload;
}

async function loadState() {
  setFatalError(null);
  dom.workspace.setAttribute("aria-busy", "true");
  try {
    const payload = await api.get("/api/state");
    applyServerState(payload, { loadAsset: true, replace: true });
    const suggestedQuery = briefQuery(ui.serverState.brief);
    if (!dom.searchQuery.value && suggestedQuery) dom.searchQuery.value = suggestedQuery;
  } catch (error) {
    setFatalError(error.message);
  } finally {
    dom.workspace.setAttribute("aria-busy", "false");
  }
}

function applyServerState(rawPayload, options = {}) {
  const payload = rawPayload?.state && typeof rawPayload.state === "object" ? rawPayload.state : rawPayload;
  if (!payload || typeof payload !== "object") return;
  const previousAssetKey = selectionAssetKey(ui.serverState.selection);
  if (options.replace) {
    ui.serverState = {
      story: payload.story || null,
      brief: payload.brief || null,
      selection: payload.selection || null,
      locked: Boolean(payload.locked),
      providerStatus: payload.providerStatus || null,
    };
  } else {
    for (const key of ["story", "brief", "selection", "locked", "providerStatus"]) {
      if (Object.hasOwn(payload, key)) ui.serverState[key] = payload[key];
    }
    ui.serverState.locked = Boolean(ui.serverState.locked);
  }

  ui.draft = draftFromSelection(ui.serverState.selection);
  ui.draftDirty = false;
  renderStoryHeader();
  renderProviderStatus();
  renderLockState();
  renderCandidates();
  renderUploadContext();
  renderSelection();
  syncTuningControls();
  renderInspector();

  const nextAssetKey = selectionAssetKey(ui.serverState.selection);
  if (options.loadAsset !== false && nextAssetKey !== previousAssetKey) {
    loadSelectionAsset(ui.serverState.selection);
  } else if (!nextAssetKey) {
    clearPreviewAsset();
  } else {
    applyDraftToPreview();
  }
}

function renderStoryHeader() {
  const story = ui.serverState.story || {};
  const brief = ui.serverState.brief;
  dom.storyTitle.textContent = story.title || story.name || story.slug || "Untitled StoryVR story";
  dom.storySummary.textContent = storySummary(story, brief);
  dom.environmentBrief.textContent = briefDescription(brief);
}

function renderProviderStatus() {
  const entries = normalizeProviderStatus(ui.serverState.providerStatus);
  if (!entries.length) {
    dom.providerStatus.innerHTML = `<span class="provider-chip neutral"><span class="provider-dot"></span>Providers pending</span>`;
    return;
  }
  dom.providerStatus.innerHTML = entries.map((entry) => {
    const health = providerHealth(entry);
    const detail = entry.message || entry.detail || entry.reason || health.label;
    return `<span class="provider-chip ${health.className}" title="${escapeHtml(detail)}"><span class="provider-dot"></span>${escapeHtml(entry.label)} · ${escapeHtml(health.label)}</span>`;
  }).join("");
}

function renderLockState() {
  const locked = Boolean(ui.serverState.locked);
  dom.lockBadge.className = `lock-badge ${locked ? "locked" : "draft"}`;
  dom.lockBadge.innerHTML = `<span class="lock-dot" aria-hidden="true"></span><span>${locked ? "Locked" : "Draft"}</span>`;
  dom.lockButton.hidden = locked;
  dom.unlockButton.hidden = !locked;
  dom.lockButton.disabled = !ui.serverState.selection || ui.operationBusy;
  dom.unlockButton.disabled = ui.operationBusy;
  dom.searchQuery.disabled = locked || ui.searchBusy || ui.operationBusy;
  dom.searchButton.disabled = locked || ui.searchBusy || ui.operationBusy;
  dom.environmentFile.disabled = locked || ui.operationBusy;
  const uploadFile = dom.environmentFile.files?.[0];
  dom.uploadButton.disabled = locked || ui.operationBusy || !uploadFile || !validateUploadFile(uploadFile).valid;
  dom.uploadForm.classList.toggle("locked", locked);
  for (const control of dom.tuningForm.querySelectorAll("[data-draft-control]")) {
    control.disabled = locked || !ui.serverState.selection || ui.operationBusy;
  }
}

function renderCandidates() {
  dom.resultCount.textContent = String(ui.candidates.length);
  if (!ui.candidates.length) {
    const searched = Boolean(dom.searchQuery.value.trim() && dom.searchStatus.dataset.searched === "true");
    dom.candidateResults.innerHTML = searched
      ? `<div class="empty-state compact"><span class="empty-icon" aria-hidden="true">∅</span><strong>No matching environments</strong><p>Try a broader place description or check provider availability.</p></div>`
      : `<div class="empty-state compact"><span class="empty-icon" aria-hidden="true">⌂</span><strong>No search yet</strong><p>Results will include source, license, format, and performance evidence.</p></div>`;
    return;
  }

  const importedId = selectionCandidateId(ui.serverState.selection);
  dom.candidateResults.innerHTML = ui.candidates.map((candidate) => {
    const id = candidateId(candidate);
    const active = id === ui.activeCandidateId;
    const imported = id === importedId;
    const license = candidateLicense(candidate);
    const sourceUrl = safeExternalUrl(candidate.sourceUrl || candidate.pageUrl || candidate.url);
    const thumbnail = safeAssetUrl(candidate.previewUrl || candidate.thumbnailUrl || candidate.thumbnail || candidate.previewImage || candidate.images?.[0]?.url);
    const metrics = candidateMetricChips(candidate);
    const provider = candidateProvider(candidate);
    return `
      <article class="candidate-card ${active ? "active" : ""} ${imported ? "imported" : ""}" data-candidate-card="${escapeHtml(id)}">
        <button class="candidate-select" type="button" data-select-candidate="${escapeHtml(id)}" aria-pressed="${active}" aria-label="Link ${escapeHtml(candidateTitle(candidate))} to the upload form">
          <span class="candidate-thumbnail ${thumbnail ? "" : "placeholder"}">
            ${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span aria-hidden="true">ENV</span>`}
            <span class="provider-label">${escapeHtml(provider)}</span>
            ${imported ? `<span class="imported-label">Uploaded</span>` : ""}
          </span>
          <span class="candidate-body">
            <span class="candidate-title-row">
              <strong>${escapeHtml(candidateTitle(candidate))}</strong>
              <span class="format-chip">${escapeHtml(candidateFormat(candidate))}</span>
            </span>
            <span class="candidate-description">${escapeHtml(shortText(candidate.description || candidate.summary || "Public environment candidate.", 126))}</span>
            <span class="candidate-license"><span aria-hidden="true">©</span>${escapeHtml(license.label)}</span>
            <span class="metric-chip-row">${metrics.map((metric) => `<span>${escapeHtml(metric)}</span>`).join("")}</span>
          </span>
        </button>
        <div class="candidate-actions">
          ${sourceUrl ? `<a class="source-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Open original asset page <span aria-hidden="true">↗</span></a>` : `<span class="source-link unavailable">Original page unavailable</span>`}
          <span class="candidate-link-state ${active ? "active" : ""}">${active ? "Linked to upload" : "Select to link metadata"}</span>
        </div>
      </article>
    `;
  }).join("");
  bindCandidateEvents();
}

function bindCandidateEvents() {
  for (const button of dom.candidateResults.querySelectorAll("[data-select-candidate]")) {
    button.addEventListener("click", () => {
      ui.activeCandidateId = button.dataset.selectCandidate;
      renderCandidates();
      renderUploadContext();
      dom.environmentFile.focus({ preventScroll: true });
    });
  }
}

function renderUploadContext() {
  const candidate = ui.candidates.find((item) => candidateId(item) === ui.activeCandidateId);
  if (!candidate) {
    dom.uploadSourceContext.innerHTML = `
      <span class="selection-kicker">Source metadata</span>
      <strong>No search result linked</strong>
      <p>You can upload your own environment, or select a result above to preserve its source details.</p>
    `;
    return;
  }
  const sourceUrl = safeExternalUrl(candidate.sourceUrl || candidate.pageUrl || candidate.url);
  dom.uploadSourceContext.innerHTML = `
    <span class="selection-kicker">Source metadata linked</span>
    <strong>${escapeHtml(candidateTitle(candidate))}</strong>
    <p>${escapeHtml(candidateProvider(candidate))} · ${escapeHtml(candidateLicense(candidate).label)}${sourceUrl ? ` · <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">open source page <span aria-hidden="true">↗</span></a>` : ""}</p>
  `;
}

function renderSelection() {
  const selection = ui.serverState.selection;
  const asset = selectionAsset(selection);
  if (!selection || !asset) {
    dom.selectionTitle.textContent = "Nothing uploaded";
    dom.selectionSubtitle.textContent = "Download an asset from its source page, then upload it above.";
    dom.resetCamera.disabled = true;
    dom.lockButton.disabled = true;
    return;
  }
  dom.selectionTitle.textContent = selectionTitle(selection);
  dom.selectionSubtitle.textContent = [candidateProvider(selection), humanMediaType(asset.mediaType), ui.serverState.locked ? "Approved" : "Draft upload"]
    .filter(Boolean)
    .join(" · ");
  dom.resetCamera.disabled = !preview.hasAsset;
  dom.lockButton.disabled = ui.operationBusy;
}

function renderInspector() {
  const selection = ui.serverState.selection;
  const asset = selectionAsset(selection);
  if (!selection || !asset) {
    dom.inspectorContent.innerHTML = `
      <div class="empty-state inspector-empty">
        <span class="empty-icon" aria-hidden="true">◎</span>
        <strong>No uploaded environment</strong>
        <p>Upload an asset to review its source, license, local file, and headset-readiness evidence.</p>
      </div>
    `;
    return;
  }

  const license = candidateLicense(selection);
  const sourceUrl = safeExternalUrl(selection.sourceUrl || selection.pageUrl || asset.sourceUrl || asset.pageUrl);
  const licenseUrl = safeExternalUrl(license.url);
  const metrics = selectionPerformance(selection);
  const warnings = uniqueStrings([
    ...(Array.isArray(selection.warnings) ? selection.warnings : []),
    ...(Array.isArray(metrics.warnings) ? metrics.warnings : []),
    ...(Array.isArray(asset.warnings) ? asset.warnings : []),
  ]);
  const checksum = asset.sha256 || asset.checksum || selection.sha256 || "Not reported";
  const attribution = license.attribution || selection.attribution || asset.attribution || "No attribution string supplied";

  dom.inspectorContent.innerHTML = `
    <section class="inspector-hero">
      <span class="inspector-type">${escapeHtml(humanMediaType(asset.mediaType))}</span>
      <h3>${escapeHtml(selectionTitle(selection))}</h3>
      <p>${escapeHtml(shortText(selection.description || asset.description || "Uploaded environment asset.", 220))}</p>
    </section>

    <section class="inspector-section">
      <div class="section-title-row">
        <h3>Source and license</h3>
        <span class="evidence-state ${license.label === "License not reported" ? "warning" : "good"}">${license.label === "License not reported" ? "Review" : "Recorded"}</span>
      </div>
      <dl class="evidence-list">
        ${evidenceRow("Provider", candidateProvider(selection))}
        ${evidenceRow("Provider asset ID", selectionCandidateId(selection) || asset.providerAssetId || asset.id || "Not reported")}
        ${evidenceLinkRow("Original page", sourceUrl, sourceUrl ? "Open source" : "Not reported")}
        ${evidenceLinkRow("License", licenseUrl, license.label)}
        ${evidenceRow("Attribution", attribution)}
      </dl>
    </section>

    <section class="inspector-section">
      <div class="section-title-row">
        <h3>Local artifact</h3>
        <span class="evidence-state good">Uploaded</span>
      </div>
      <dl class="evidence-list">
        ${evidenceRow("Media type", asset.mediaType || "Not reported")}
        ${evidenceRow("Local URL", asset.localUrl || "Not reported", "path")}
        ${evidenceRow("Uploaded size", formatBytes(asset.bytes || asset.sizeBytes || metrics.uploadBytes || metrics.packagedBytes || metrics.bytes))}
        ${evidenceRow("SHA-256", checksum, "path")}
      </dl>
    </section>

    <section class="inspector-section">
      <div class="section-title-row">
        <h3>Performance evidence</h3>
        <span class="evidence-state ${warnings.length ? "warning" : "good"}">${warnings.length ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "No warnings"}</span>
      </div>
      <div class="performance-grid">
        ${performanceMetric("Triangles", formatCount(metrics.triangles || metrics.triangleCount || metrics.polygons))}
        ${performanceMetric("Draw calls", formatCount(metrics.drawCalls))}
        ${performanceMetric("Textures", formatCount(metrics.textures || metrics.textureCount))}
        ${performanceMetric("Max texture", formatResolution(metrics.maxTextureSize || metrics.maxTextureResolution))}
      </div>
      ${warnings.length ? `<ul class="warning-list">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : `<p class="inspector-note">The uploaded asset has no reported performance warnings. Verify on the target headset before publishing.</p>`}
    </section>

    <section class="inspector-section compact-provenance">
      <h3>Approval scope</h3>
      <p>This asset is the persistent environmental surrounding. It does not replace Source Graph assets, drive story motion, or take over the WebXR camera.</p>
    </section>
  `;
}

function bindEvents() {
  dom.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    searchCandidates();
  });
  dom.uploadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    uploadEnvironment();
  });
  dom.environmentFile.addEventListener("change", handleUploadFileChange);
  dom.resetCamera.addEventListener("click", () => framePreviewAsset());
  dom.lockButton.addEventListener("click", lockSelection);
  dom.unlockButton.addEventListener("click", unlockSelection);
  dom.retryLoad.addEventListener("click", loadState);

  for (const control of dom.tuningForm.querySelectorAll("[data-draft-control]")) {
    control.addEventListener("input", handleDraftInput);
    control.addEventListener("change", handleDraftInput);
  }
}

async function searchCandidates() {
  const query = dom.searchQuery.value.trim();
  if (!query || ui.serverState.locked || ui.searchBusy) return;
  ui.searchBusy = true;
  ui.activeCandidateId = null;
  renderUploadContext();
  dom.searchStatus.dataset.searched = "true";
  dom.searchStatus.textContent = `Searching public libraries for “${query}”…`;
  renderLockState();
  dom.candidateResults.setAttribute("aria-busy", "true");
  try {
    const result = await api.get(`/api/search?q=${encodeURIComponent(query)}`);
    ui.candidates = Array.isArray(result.candidates) ? result.candidates : [];
    if (Object.hasOwn(result, "providerStatus")) ui.serverState.providerStatus = result.providerStatus;
    dom.searchStatus.textContent = ui.candidates.length
      ? `${ui.candidates.length} candidate${ui.candidates.length === 1 ? "" : "s"} found for “${query}”. Open a source page to download an asset, then upload it below.`
      : `No environments found for “${query}”.`;
    renderProviderStatus();
    renderCandidates();
    dom.candidateResults.querySelector("[data-select-candidate]")?.focus({ preventScroll: true });
  } catch (error) {
    ui.candidates = [];
    dom.searchStatus.textContent = `Search failed: ${error.message}`;
    renderCandidates();
    showToast(error.message, "error");
  } finally {
    ui.searchBusy = false;
    dom.candidateResults.removeAttribute("aria-busy");
    renderLockState();
  }
}

function handleUploadFileChange() {
  const file = dom.environmentFile.files?.[0];
  if (!file) {
    dom.uploadStatus.textContent = "Choose a supported environment file from your computer.";
    dom.uploadStatus.className = "upload-status";
    renderLockState();
    return;
  }
  const validation = validateUploadFile(file);
  dom.uploadStatus.textContent = validation.valid
    ? `${file.name} · ${formatBytes(file.size)} ready to upload.`
    : validation.reason;
  dom.uploadStatus.className = `upload-status ${validation.valid ? "ready" : "error"}`;
  renderLockState();
  if (!validation.valid) dom.uploadButton.disabled = true;
}

async function uploadEnvironment() {
  const file = dom.environmentFile.files?.[0];
  if (!file || ui.serverState.locked || ui.operationBusy) return;
  const validation = validateUploadFile(file);
  if (!validation.valid) {
    dom.uploadStatus.textContent = validation.reason;
    dom.uploadStatus.className = "upload-status error";
    showToast(validation.reason, "error");
    return;
  }
  ui.operationBusy = true;
  renderLockState();
  renderCandidates();
  dom.uploadStatus.textContent = `Uploading ${file.name}…`;
  dom.uploadStatus.className = "upload-status busy";
  setViewerLoading(true, `Uploading ${file.name}…`);
  try {
    const query = new URLSearchParams({ filename: file.name });
    const candidate = ui.candidates.find((item) => candidateId(item) === ui.activeCandidateId);
    if (candidate) query.set("candidateId", candidateId(candidate));
    const response = await api.upload(`/api/upload?${query}`, file);
    applyServerState(response, { loadAsset: true });
    dom.uploadForm.reset();
    dom.uploadStatus.textContent = `${file.name} uploaded and ready for inspection.`;
    dom.uploadStatus.className = "upload-status success";
    showToast(`${file.name} uploaded successfully.`, "success");
  } catch (error) {
    setViewerLoading(false);
    dom.uploadStatus.textContent = `Upload failed: ${error.message}`;
    dom.uploadStatus.className = "upload-status error";
    showToast(error.message, "error");
  } finally {
    ui.operationBusy = false;
    renderLockState();
    renderCandidates();
  }
}

function validateUploadFile(file) {
  const extension = String(file?.name || "").toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  if (![".glb", ".gltf", ".zip", ".hdr", ".exr"].includes(extension)) {
    return { valid: false, reason: "Choose a .glb, .gltf, .zip, .hdr, or .exr environment file." };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { valid: false, reason: "The selected file is empty." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { valid: false, reason: "Choose a file no larger than 120 MiB." };
  }
  return { valid: true, reason: "" };
}

function handleDraftInput() {
  if (!ui.serverState.selection || ui.serverState.locked) return;
  ui.draft = draftFromControls();
  ui.draftDirty = true;
  ui.draftRevision += 1;
  updateControlOutputs();
  applyDraftToPreview();
  dom.draftSaveState.textContent = "Unsaved changes";
  dom.draftSaveState.className = "save-state dirty";
  clearTimeout(ui.draftTimer);
  ui.draftTimer = setTimeout(() => saveDraft(ui.draftRevision), 320);
}

async function saveDraft(revision = ui.draftRevision) {
  if (!ui.draftDirty || !ui.serverState.selection || ui.serverState.locked) return;
  clearTimeout(ui.draftTimer);
  ui.draftTimer = null;
  const snapshot = cloneValue(ui.draft);
  dom.draftSaveState.textContent = "Saving…";
  dom.draftSaveState.className = "save-state saving";
  try {
    const response = await api.patch("/api/draft", snapshot);
    if (revision !== ui.draftRevision) return;
    ui.draftDirty = false;
    applyServerState(response, { loadAsset: false });
    dom.draftSaveState.textContent = "Saved locally";
    dom.draftSaveState.className = "save-state saved";
  } catch (error) {
    if (revision !== ui.draftRevision) return;
    dom.draftSaveState.textContent = "Save failed";
    dom.draftSaveState.className = "save-state error";
    showToast(error.message, "error");
  }
}

async function flushDraft() {
  if (!ui.draftDirty) return;
  await saveDraft(ui.draftRevision);
  if (ui.draftDirty) throw new Error("Save the environment tuning before locking.");
}

async function lockSelection() {
  if (!ui.serverState.selection || ui.serverState.locked || ui.operationBusy) return;
  ui.operationBusy = true;
  renderLockState();
  try {
    await flushDraft();
    const response = await api.post("/api/lock");
    applyServerState(response, { loadAsset: false });
    showToast("Environment approved and locked.", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    ui.operationBusy = false;
    renderLockState();
  }
}

async function unlockSelection() {
  if (!ui.serverState.locked || ui.operationBusy) return;
  ui.operationBusy = true;
  renderLockState();
  try {
    const response = await api.post("/api/unlock");
    applyServerState(response, { loadAsset: false });
    showToast("Environment unlocked for editing.", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    ui.operationBusy = false;
    renderLockState();
  }
}

function syncTuningControls() {
  const { transform, rendering } = ui.draft;
  setControlValue(dom.positionX, transform.position[0]);
  setControlValue(dom.positionY, transform.position[1]);
  setControlValue(dom.positionZ, transform.position[2]);
  setControlValue(dom.rotationY, THREE.MathUtils.radToDeg(transform.rotationY));
  setControlValue(dom.environmentScale, transform.scale);
  setControlValue(dom.exposure, rendering.exposure);
  dom.fogColor.value = normalizeHexColor(rendering.fogColor, DEFAULT_RENDERING.fogColor);
  setControlValue(dom.fogDensity, rendering.fogDensity);
  dom.backgroundMode.value = normalizeBackgroundMode(rendering.backgroundMode);
  if (!dom.backgroundMode.value) dom.backgroundMode.value = DEFAULT_RENDERING.backgroundMode;
  updateControlOutputs();
  dom.draftSaveState.textContent = ui.serverState.selection ? (ui.serverState.locked ? "Locked" : "Saved locally") : "No draft";
  dom.draftSaveState.className = `save-state ${ui.serverState.locked ? "locked" : ui.serverState.selection ? "saved" : ""}`;
  renderLockState();
}

function draftFromControls() {
  return {
    transform: {
      position: [numberValue(dom.positionX, 0), numberValue(dom.positionY, 0), numberValue(dom.positionZ, 0)],
      rotationY: THREE.MathUtils.degToRad(numberValue(dom.rotationY, 0)),
      scale: Math.max(0.001, numberValue(dom.environmentScale, 1)),
    },
    rendering: {
      exposure: Math.max(0.01, numberValue(dom.exposure, 1)),
      fogColor: normalizeHexColor(dom.fogColor.value, DEFAULT_RENDERING.fogColor),
      fogDensity: Math.max(0, numberValue(dom.fogDensity, 0)),
      backgroundMode: normalizeBackgroundMode(dom.backgroundMode.value),
    },
  };
}

function updateControlOutputs() {
  dom.positionXValue.textContent = `${numberValue(dom.positionX, 0).toFixed(2)} m`;
  dom.positionYValue.textContent = `${numberValue(dom.positionY, 0).toFixed(2)} m`;
  dom.positionZValue.textContent = `${numberValue(dom.positionZ, 0).toFixed(2)} m`;
  dom.rotationYValue.textContent = `${Math.round(numberValue(dom.rotationY, 0))}°`;
  dom.environmentScaleValue.textContent = `${numberValue(dom.environmentScale, 1).toFixed(2)}×`;
  dom.exposureValue.textContent = numberValue(dom.exposure, 1).toFixed(2);
  dom.fogDensityValue.textContent = numberValue(dom.fogDensity, 0).toFixed(3);
}

function createPersistentPreview() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.xr.enabled = true;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("aria-label", "Environment preview canvas");
  dom.viewer.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(54, 1, 0.01, 4000);
  camera.position.set(4.8, 3.2, 5.8);
  scene.add(camera);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.target.set(0, 1.25, 0);
  controls.maxPolarAngle = Math.PI * 0.98;

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x5b625f, 1.6);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight(0xfff2d8, 2.2);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  scene.add(key);

  const environmentRoot = new THREE.Group();
  environmentRoot.name = "environment-enhancement-root";
  scene.add(environmentRoot);

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  dracoLoader.setWorkerLimit(2);
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  const state = {
    renderer,
    scene,
    camera,
    controls,
    environmentRoot,
    dracoLoader,
    gltfLoader,
    hdrLoader: new RGBELoader(),
    exrLoader: new EXRLoader(),
    environmentTexture: null,
    hasAsset: false,
    assetKind: null,
    loadToken: 0,
    lastFrameAt: performance.now(),
    resizeObserver: null,
  };

  const vrButton = VRButton.createButton(renderer);
  vrButton.id = "enter-vr-button";
  vrButton.className = "button vr-button";
  vrButton.setAttribute("aria-label", "Enter VR environment preview");
  Object.assign(vrButton.style, {
    position: "static",
    left: "auto",
    right: "auto",
    bottom: "auto",
    width: "auto",
    height: "auto",
    border: "",
    borderRadius: "",
    background: "",
    color: "",
    font: "",
    opacity: "",
    padding: "",
    margin: "",
  });
  if (dom.xrButtonSlot) dom.xrButtonSlot.append(vrButton);

  const resize = () => {
    const width = Math.max(dom.viewer.clientWidth, 320);
    const height = Math.max(dom.viewer.clientHeight, 360);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  state.resizeObserver = new ResizeObserver(resize);
  state.resizeObserver.observe(dom.viewer);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return state;
}

async function loadSelectionAsset(selection) {
  const asset = selectionAsset(selection);
  const localUrl = String(asset?.localUrl || "").trim();
  const mediaType = normalizeMediaType(asset?.mediaType, localUrl);
  const token = ++preview.loadToken;
  clearPreviewAsset({ preserveToken: true });
  if (!asset || !localUrl) return;

  setViewerLoading(true, `Loading ${selectionTitle(selection)}…`);
  const url = new URL(localUrl, window.location.href).href;
  try {
    if (MODEL_MEDIA_TYPES.has(mediaType)) {
      const gltf = await loadWithLoader(preview.gltfLoader, url);
      if (token !== preview.loadToken) {
        disposeObject(gltf.scene);
        return;
      }
      // Uploaded cameras may remain as inert scene nodes, but the preview always renders
      // through the author-controlled camera above, including in WebXR.
      preview.environmentRoot.add(gltf.scene);
      preview.assetKind = "model";
      preview.hasAsset = true;
      applyDraftToPreview();
      framePreviewAsset();
    } else if (HDR_MEDIA_TYPES.has(mediaType) || EXR_MEDIA_TYPES.has(mediaType)) {
      const loader = EXR_MEDIA_TYPES.has(mediaType) ? preview.exrLoader : preview.hdrLoader;
      const texture = await loadWithLoader(loader, url);
      if (token !== preview.loadToken) {
        texture.dispose();
        return;
      }
      texture.mapping = THREE.EquirectangularReflectionMapping;
      preview.environmentTexture = texture;
      preview.assetKind = "panorama";
      preview.hasAsset = true;
      applyDraftToPreview();
      framePreviewAsset();
    } else {
      throw new Error(`Unsupported environment media type: ${mediaType || "unknown"}`);
    }
    setViewerLoading(false);
    dom.viewerEmpty.hidden = true;
    dom.viewerMessage.textContent = `${selectionTitle(selection)} loaded. The StoryVR camera remains author-controlled.`;
    dom.resetCamera.disabled = false;
    renderSelection();
  } catch (error) {
    if (token !== preview.loadToken) return;
    clearPreviewAsset({ preserveToken: true });
    setViewerLoading(false);
    dom.viewerMessage.textContent = `Could not load the uploaded environment: ${error.message}`;
    dom.viewerEmpty.hidden = false;
    showToast(error.message, "error");
  }
}

function loadWithLoader(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, (error) => reject(error instanceof Error ? error : new Error("Asset loading failed.")));
  });
}

function clearPreviewAsset(options = {}) {
  if (!options.preserveToken) preview.loadToken += 1;
  for (const child of [...preview.environmentRoot.children]) {
    preview.environmentRoot.remove(child);
    disposeObject(child);
  }
  if (preview.environmentTexture) preview.environmentTexture.dispose();
  preview.environmentTexture = null;
  preview.scene.environment = null;
  preview.scene.background = null;
  preview.hasAsset = false;
  preview.assetKind = null;
  dom.viewerEmpty.hidden = false;
  dom.viewerMessage.textContent = "";
  dom.resetCamera.disabled = true;
  applyDraftToPreview();
}

function disposeObject(root) {
  root?.traverse?.((node) => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose();
      }
      material.dispose?.();
    }
  });
}

function applyDraftToPreview() {
  const transform = ui.draft.transform;
  const rendering = ui.draft.rendering;
  preview.environmentRoot.position.fromArray(transform.position);
  preview.environmentRoot.rotation.set(0, transform.rotationY, 0);
  preview.environmentRoot.scale.setScalar(transform.scale);
  preview.environmentRoot.updateMatrixWorld(true);

  preview.renderer.toneMappingExposure = rendering.exposure;
  preview.scene.environment = preview.environmentTexture;
  preview.scene.fog = rendering.fogDensity > 0
    ? new THREE.FogExp2(new THREE.Color(rendering.fogColor), rendering.fogDensity)
    : null;

  const backgroundMode = normalizeBackgroundMode(rendering.backgroundMode);
  if (backgroundMode === "asset" && preview.environmentTexture) {
    preview.scene.background = preview.environmentTexture;
    preview.renderer.setClearAlpha(1);
  } else if (backgroundMode === "fog-color") {
    preview.scene.background = new THREE.Color(rendering.fogColor);
    preview.renderer.setClearAlpha(1);
  } else if (backgroundMode === "transparent") {
    preview.scene.background = null;
    preview.renderer.setClearColor(0x000000, 0);
  } else {
    preview.scene.background = new THREE.Color(rendering.fogColor);
    preview.renderer.setClearAlpha(1);
  }
}

function framePreviewAsset() {
  if (!preview.hasAsset) return;
  if (preview.assetKind === "panorama") {
    preview.camera.position.set(0, 1.6, 0.01);
    preview.controls.target.set(0, 1.6, -1);
    preview.camera.near = 0.01;
    preview.camera.far = 2000;
    preview.camera.updateProjectionMatrix();
    preview.controls.minDistance = 0.01;
    preview.controls.maxDistance = 10;
    preview.controls.update();
    return;
  }

  preview.environmentRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(preview.environmentRoot);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z, 0.1);
  const distance = Math.min(Math.max(maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(preview.camera.fov * 0.5))) * 1.18, 1.5), 1800);
  const direction = new THREE.Vector3(1, 0.58, 1).normalize();
  preview.camera.position.copy(center).add(direction.multiplyScalar(distance));
  preview.controls.target.copy(center);
  preview.camera.near = Math.max(maxSize / 10000, 0.005);
  preview.camera.far = Math.max(maxSize * 25, 500);
  preview.camera.updateProjectionMatrix();
  preview.controls.minDistance = Math.max(maxSize * 0.002, 0.01);
  preview.controls.maxDistance = Math.max(maxSize * 8, 20);
  preview.controls.update();
}

function setViewerLoading(loading, message = "Loading environment…") {
  dom.viewerLoading.hidden = !loading;
  const label = dom.viewerLoading.querySelector("strong");
  if (label) label.textContent = message;
  if (loading) dom.viewerMessage.textContent = "";
}

function draftFromSelection(selection) {
  const sourceTransform = selection?.transform || {};
  const sourceRendering = selection?.rendering || {};
  const positionSource = Array.isArray(sourceTransform.position)
    ? sourceTransform.position
    : [sourceTransform.position?.x, sourceTransform.position?.y, sourceTransform.position?.z];
  return {
    transform: {
      position: [0, 1, 2].map((index) => finiteNumber(positionSource[index], DEFAULT_TRANSFORM.position[index])),
      rotationY: normalizedRotationRadians(sourceTransform.rotationY),
      scale: Math.max(0.001, finiteNumber(sourceTransform.scale, DEFAULT_TRANSFORM.scale)),
    },
    rendering: {
      exposure: Math.max(0.01, finiteNumber(sourceRendering.exposure, DEFAULT_RENDERING.exposure)),
      fogColor: normalizeHexColor(sourceRendering.fogColor, DEFAULT_RENDERING.fogColor),
      fogDensity: Math.max(0, finiteNumber(sourceRendering.fogDensity, DEFAULT_RENDERING.fogDensity)),
      backgroundMode: normalizeBackgroundMode(sourceRendering.backgroundMode),
    },
  };
}

function normalizeProviderStatus(status) {
  if (Array.isArray(status)) {
    return status.map((entry, index) => ({
      ...(typeof entry === "object" ? entry : { status: entry }),
      id: entry?.id || entry?.provider || `provider-${index + 1}`,
      label: entry?.label || entry?.name || entry?.provider || `Provider ${index + 1}`,
    }));
  }
  if (!status || typeof status !== "object") return [];
  return Object.entries(status).map(([id, value]) => ({
    ...(typeof value === "object" ? value : { status: value }),
    id,
    label: value?.label || value?.name || id,
  }));
}

function providerHealth(entry) {
  const value = String(entry.status ?? entry.state ?? entry.health ?? (entry.ok === true ? "available" : entry.ok === false ? "unavailable" : "unknown")).toLowerCase();
  if (/down|error|offline|unavailable|failed/.test(value)) return { className: "bad", label: "Unavailable" };
  if (/token|auth|credential|limited/.test(value)) return { className: "auth", label: "Limited" };
  if (/available|healthy|ready|online|ok|connected/.test(value)) return { className: "good", label: "Ready" };
  return { className: "neutral", label: "Unknown" };
}

function candidateMetricChips(candidate) {
  const metrics = candidate.performance || candidate.metrics || {};
  return [
    Number.isFinite(Number(metrics.triangles || metrics.triangleCount || candidate.triangles))
      ? `${formatCount(metrics.triangles || metrics.triangleCount || candidate.triangles)} tris`
      : null,
    Number.isFinite(Number(metrics.downloadBytes || metrics.bytes || candidate.downloadBytes || candidate.bytes || candidate.sizeBytes))
      ? formatBytes(metrics.downloadBytes || metrics.bytes || candidate.downloadBytes || candidate.bytes || candidate.sizeBytes)
      : null,
    metrics.maxTextureSize || metrics.maxTextureResolution
      ? `max ${formatResolution(metrics.maxTextureSize || metrics.maxTextureResolution)}`
      : null,
  ].filter(Boolean).slice(0, 3);
}

function candidateLicense(candidate) {
  const source = candidate?.license;
  if (typeof source === "string") return { label: source, url: "", attribution: "" };
  if (source && typeof source === "object") {
    return {
      label: source.name || source.label || source.spdx || source.id || "License reported",
      url: source.url || source.uri || "",
      attribution: source.attribution || source.credit || "",
    };
  }
  return {
    label: candidate?.licenseName || candidate?.licenseLabel || "License not reported",
    url: candidate?.licenseUrl || "",
    attribution: candidate?.attribution || "",
  };
}

function candidateId(candidate) {
  return String(candidate?.candidateId || candidate?.id || candidate?.providerAssetId || candidate?.uid || "").trim();
}

function candidateTitle(candidate) {
  return String(candidate?.title || candidate?.name || candidate?.label || candidateId(candidate) || "Untitled environment");
}

function candidateProvider(candidate) {
  return String(candidate?.providerLabel || candidate?.provider || candidate?.source?.provider || candidate?.asset?.provider || "Public catalog");
}

function candidateFormat(candidate) {
  if (candidate?.formatLabel) return String(candidate.formatLabel);
  const mediaType = normalizeMediaType(candidate?.mediaType || candidate?.asset?.mediaType, candidate?.downloadUrl || candidate?.asset?.localUrl || "");
  if (mediaType === "model/gltf-binary") return "GLB";
  if (mediaType === "model/gltf+json") return "glTF";
  if (HDR_MEDIA_TYPES.has(mediaType)) return "HDR";
  if (EXR_MEDIA_TYPES.has(mediaType)) return "EXR";
  return String(candidate?.format || "ENV").toUpperCase();
}

function selectionAsset(selection) {
  return selection?.asset && typeof selection.asset === "object" ? selection.asset : null;
}

function selectionAssetKey(selection) {
  const asset = selectionAsset(selection);
  return asset ? `${asset.localUrl || ""}|${asset.mediaType || ""}|${asset.sha256 || asset.checksum || ""}` : "";
}

function selectionCandidateId(selection) {
  return String(selection?.candidateId || selection?.id || selection?.candidate?.id || selection?.providerAssetId || selection?.asset?.providerAssetId || selection?.asset?.candidateId || "");
}

function selectionTitle(selection) {
  return String(selection?.title || selection?.name || selection?.label || selection?.asset?.title || selection?.asset?.name || selectionCandidateId(selection) || "Uploaded environment");
}

function selectionPerformance(selection) {
  return selection?.performance || selection?.metrics || selection?.asset?.performance || selection?.asset?.metrics || {};
}

function storySummary(story, brief) {
  return shortText(story.subtitle || story.summary || brief?.storySummary || brief?.summary || story.sourceUrl || "One story, one persistent surrounding.", 180);
}

function briefDescription(brief) {
  if (typeof brief === "string") return brief;
  return shortText(brief?.description || brief?.environmentBrief || brief?.rationale || "Search licensed public libraries for a setting that surrounds the story assets.", 280);
}

function briefQuery(brief) {
  if (!brief || typeof brief !== "object") return "";
  return String(brief.query || brief.searchQuery || brief.environmentQuery || brief.suggestedQuery || "").trim();
}

function normalizeMediaType(value, url = "") {
  const type = String(value || "").toLowerCase().split(";")[0].trim();
  if (type) return type;
  const pathname = String(url).toLowerCase().split(/[?#]/)[0];
  if (pathname.endsWith(".glb")) return "model/gltf-binary";
  if (pathname.endsWith(".gltf")) return "model/gltf+json";
  if (pathname.endsWith(".hdr")) return "image/vnd.radiance";
  if (pathname.endsWith(".exr")) return "image/x-exr";
  return "";
}

function humanMediaType(value) {
  const type = normalizeMediaType(value);
  if (type === "model/gltf-binary") return "3D GLB scene";
  if (type === "model/gltf+json") return "3D glTF scene";
  if (HDR_MEDIA_TYPES.has(type)) return "HDR panorama";
  if (EXR_MEDIA_TYPES.has(type)) return "EXR panorama";
  return type || "Environment asset";
}

function normalizeBackgroundMode(value) {
  const text = String(value || "").toLowerCase();
  if (/transparent|none|alpha/.test(text)) return "transparent";
  if (/fog|color|solid/.test(text)) return "fog-color";
  return "asset";
}

function normalizedRotationRadians(value) {
  const number = finiteNumber(value, 0);
  return Math.abs(number) > Math.PI * 2 + 0.01 ? THREE.MathUtils.degToRad(number) : number;
}

function normalizeHexColor(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

function setControlValue(control, value) {
  const min = finiteNumber(control.min, -Infinity);
  const max = finiteNumber(control.max, Infinity);
  control.value = String(Math.max(min, Math.min(max, finiteNumber(value, 0))));
}

function numberValue(control, fallback) {
  return finiteNumber(control?.value, fallback);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function evidenceRow(label, value, className = "") {
  return `<div><dt>${escapeHtml(label)}</dt><dd class="${className}">${escapeHtml(value ?? "Not reported")}</dd></div>`;
}

function evidenceLinkRow(label, url, value) {
  return url
    ? `<div><dt>${escapeHtml(label)}</dt><dd><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(value)} <span aria-hidden="true">↗</span></a></dd></div>`
    : evidenceRow(label, value);
}

function performanceMetric(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not reported")}</strong></div>`;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "Not reported";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let amount = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index];
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
}

function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Not reported";
  return new Intl.NumberFormat("en-US", { notation: number >= 100000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(number);
}

function formatResolution(value) {
  if (Array.isArray(value)) return value.map((item) => formatCount(item)).join(" × ");
  if (value && typeof value === "object") return `${formatCount(value.width)} × ${formatCount(value.height)}`;
  const number = Number(value);
  return Number.isFinite(number) ? `${formatCount(number)} px` : "Not reported";
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function safeAssetUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.href);
    return ["http:", "https:", "blob:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function shortText(value, max = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setFatalError(message) {
  dom.fatalError.hidden = !message;
  dom.fatalErrorMessage.textContent = message || "";
}

function showToast(message, kind = "success") {
  clearTimeout(ui.toastTimer);
  dom.toast.textContent = message;
  dom.toast.className = `toast ${kind}`;
  dom.toast.hidden = false;
  ui.toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 4200);
}
