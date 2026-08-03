import {
  STEP_DEFINITIONS,
  analyzeInteractionLog,
  buildCodexEvidence,
  normalizeInteractionLog,
} from "/lib/interaction-analysis.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const TIMELINE_WIDTH = 1200;
const TIMELINE_HEIGHT = 300;
const TIMELINE_LEFT = 12;
const TIMELINE_RIGHT = 12;
const PLOT_WIDTH = TIMELINE_WIDTH - TIMELINE_LEFT - TIMELINE_RIGHT;
const STEP_COLORS = Object.freeze({
  "source-graph": "#d9ede5",
  "spatial-relations": "#dbe9f2",
  "environment-enhancement": "#e7ead2",
  "attention-guidance": "#f3e5bf",
  "dynamic-geometry": "#f2d9c8",
  "inter-beat-dynamics": "#ead9e9",
  "interaction-control": "#dcdcf1",
  "transition-pacing": "#d5e8e9",
  unknown: "#e7e9e7",
});
const FALLBACK_STEPS = Object.freeze([
  { id: "source-graph", label: "Source Graph" },
  { id: "spatial-relations", label: "Spatial Relations" },
  { id: "environment-enhancement", label: "Environment" },
  { id: "attention-guidance", label: "Attention" },
  { id: "dynamic-geometry", label: "Dynamics" },
  { id: "inter-beat-dynamics", label: "Transition" },
  { id: "interaction-control", label: "Interaction" },
  { id: "transition-pacing", label: "Final Review" },
]);
const STEPS = normalizedStepDefinitions(STEP_DEFINITIONS);
const STEP_BY_ID = new Map([...STEPS, { id: "unknown", label: "Unknown step" }].map((step, index) => [step.id, { ...step, index }]));
const MAX_TIMELINE_EVENTS = 1_100;
const TABLE_PAGE_SIZE = 60;

const elements = Object.fromEntries([
  "workspace", "load-demo", "log-files", "session-select", "session-subtitle", "export-analysis", "clear-logs",
  "metric-duration", "metric-duration-note", "metric-events", "metric-events-note", "metric-steps", "metric-steps-note",
  "metric-moments", "metric-moments-note", "step-legend", "timeline-svg", "timeline-tooltip", "timeline-scrubber",
  "window-label", "selected-event", "pan-left", "pan-right", "zoom-in", "zoom-out", "reset-view", "moment-count",
  "moment-list", "step-dwell", "journey-path", "rhythm-chart", "rhythm-summary", "click-field", "clickmap-summary",
  "target-mix", "codex-status", "run-codex", "codex-results", "event-search", "event-step-filter", "event-table-body",
  "event-table-count", "show-more-events", "quality-list", "drop-overlay", "toast",
].map((id) => [camelId(id), document.getElementById(id)]));

const state = {
  analyses: [],
  activeIndex: 0,
  selectedSequence: null,
  momentFilter: "all",
  highlightedStepId: null,
  viewStartMs: 0,
  viewEndMs: 1,
  tableLimit: TABLE_PAGE_SIZE,
  codexStatus: null,
  codexResults: new Map(),
  toastTimer: null,
  dragDepth: 0,
};

bindControls();
populateStepFilter();
await Promise.allSettled([loadDemo(), refreshCodexStatus()]);

function bindControls() {
  elements.loadDemo.addEventListener("click", () => loadDemo({ announce: true }));
  elements.logFiles.addEventListener("change", async (event) => {
    await importFiles([...event.target.files]);
    event.target.value = "";
  });
  elements.sessionSelect.addEventListener("change", () => selectSession(Number(elements.sessionSelect.value)));
  elements.clearLogs.addEventListener("click", () => {
    state.analyses = [];
    state.activeIndex = 0;
    state.selectedSequence = null;
    state.codexResults.clear();
    renderEmptyState();
    showToast("Imported logs cleared. Load the demonstration or import another log.");
  });
  elements.exportAnalysis.addEventListener("click", downloadDerivedAnalysis);

  elements.zoomIn.addEventListener("click", () => zoomTimeline(0.56));
  elements.zoomOut.addEventListener("click", () => zoomTimeline(1.75));
  elements.panLeft.addEventListener("click", () => panTimeline(-0.32));
  elements.panRight.addEventListener("click", () => panTimeline(0.32));
  elements.resetView.addEventListener("click", resetTimelineView);
  elements.timelineScrubber.addEventListener("input", () => {
    const analysis = activeAnalysis();
    if (!analysis) return;
    const duration = sessionDuration(analysis);
    const width = Math.min(duration, Math.max(1, state.viewEndMs - state.viewStartMs));
    const center = Number(elements.timelineScrubber.value) / 1000 * duration;
    setTimelineWindow(center - width / 2, center + width / 2);
  });
  elements.timelineSvg.addEventListener("click", handleTimelineActivation);
  elements.timelineSvg.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.closest?.("[data-event-sequence]")) {
      event.preventDefault();
      handleTimelineActivation(event);
    }
  });
  elements.timelineSvg.addEventListener("pointermove", showTimelineTooltip);
  elements.timelineSvg.addEventListener("pointerleave", hideTimelineTooltip);
  elements.timelineSvg.addEventListener("wheel", (event) => {
    if (!activeAnalysis()) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) zoomTimeline(event.deltaY > 0 ? 1.22 : 0.82, timelineMsAtClientX(event.clientX));
    else panTimeline(event.deltaY > 0 || event.deltaX > 0 ? 0.14 : -0.14);
  }, { passive: false });

  for (const tab of document.querySelectorAll("[data-moment-filter]")) {
    tab.addEventListener("click", () => {
      state.momentFilter = tab.dataset.momentFilter;
      for (const candidate of document.querySelectorAll("[data-moment-filter]")) {
        const selected = candidate === tab;
        candidate.classList.toggle("active", selected);
        candidate.setAttribute("aria-selected", String(selected));
      }
      renderMoments(activeAnalysis());
    });
  }

  elements.momentList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-moment-id]");
    if (!card) return;
    const moment = momentsFor(activeAnalysis()).find((candidate) => candidate.id === card.dataset.momentId);
    if (moment) focusMoment(moment);
  });

  elements.stepLegend.addEventListener("click", (event) => {
    const button = event.target.closest("[data-step-id]");
    if (!button) return;
    state.highlightedStepId = state.highlightedStepId === button.dataset.stepId ? null : button.dataset.stepId;
    renderStepLegend(activeAnalysis());
    renderTimeline(activeAnalysis());
  });

  elements.eventSearch.addEventListener("input", () => {
    state.tableLimit = TABLE_PAGE_SIZE;
    renderEventTable(activeAnalysis());
  });
  elements.eventStepFilter.addEventListener("change", () => {
    state.tableLimit = TABLE_PAGE_SIZE;
    renderEventTable(activeAnalysis());
  });
  elements.eventTableBody.addEventListener("click", (event) => {
    const row = event.target.closest("[data-event-sequence]");
    if (!row) return;
    selectEvent(Number(row.dataset.eventSequence), { focusTimeline: true });
  });
  elements.showMoreEvents.addEventListener("click", () => {
    state.tableLimit += TABLE_PAGE_SIZE;
    renderEventTable(activeAnalysis());
  });

  elements.runCodex.addEventListener("click", runCodexAnalysis);

  document.addEventListener("dragenter", (event) => {
    if (!hasFileDrag(event)) return;
    state.dragDepth += 1;
    elements.dropOverlay.hidden = false;
  });
  document.addEventListener("dragover", (event) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
  });
  document.addEventListener("dragleave", (event) => {
    if (!hasFileDrag(event)) return;
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (!state.dragDepth) elements.dropOverlay.hidden = true;
  });
  document.addEventListener("drop", async (event) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    state.dragDepth = 0;
    elements.dropOverlay.hidden = true;
    await importFiles([...event.dataTransfer.files]);
  });
}

async function loadDemo({ announce = false } = {}) {
  elements.workspace.setAttribute("aria-busy", "true");
  try {
    const response = await fetch("/sample-interaction-log.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Demo request returned HTTP ${response.status}.`);
    const payload = await response.json();
    const analysis = analyzePayload(payload, "demonstration-log.json");
    state.analyses = [analysis];
    state.activeIndex = 0;
    state.codexResults.clear();
    selectSession(0);
    if (announce) showToast("Demonstration session restored.");
  } catch (error) {
    renderEmptyState(error.message);
  } finally {
    elements.workspace.setAttribute("aria-busy", "false");
  }
}

async function importFiles(files) {
  const jsonFiles = files.filter((file) => file.name.toLowerCase().endsWith(".json") || file.type === "application/json");
  if (!jsonFiles.length) {
    showToast("Choose one or more StoryVR log files in JSON format.");
    return;
  }
  elements.workspace.setAttribute("aria-busy", "true");
  const imported = [];
  const errors = [];
  for (const file of jsonFiles) {
    try {
      const parsed = JSON.parse(await file.text());
      const payloads = interactionPayloadsFromJson(parsed);
      if (!payloads.length) throw new Error("No StoryVR session was found in this file.");
      payloads.forEach((payload, index) => imported.push(analyzePayload(payload, payloads.length > 1 ? `${file.name} · ${index + 1}` : file.name)));
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  if (imported.length) {
    state.analyses = imported;
    state.activeIndex = 0;
    state.codexResults.clear();
    selectSession(0);
  }
  elements.workspace.setAttribute("aria-busy", "false");
  const result = imported.length ? `${imported.length} session${imported.length === 1 ? "" : "s"} imported.` : "No sessions imported.";
  showToast(errors.length ? `${result} ${errors.join(" ")}` : result, errors.length ? 7000 : 3500);
}

function analyzePayload(payload, fileName) {
  const normalized = normalizeInteractionLog(payload, { fileName });
  const analysis = analyzeInteractionLog(normalized);
  return Object.freeze({ ...analysis, fileName });
}

function interactionPayloadsFromJson(value) {
  if (Array.isArray(value)) return value.flatMap(interactionPayloadsFromJson);
  if (value && Array.isArray(value.sessions)) return value.sessions.flatMap(interactionPayloadsFromJson);
  return value && typeof value === "object" ? [value] : [];
}

function selectSession(index) {
  if (!state.analyses.length) {
    renderEmptyState();
    return;
  }
  state.activeIndex = Math.max(0, Math.min(state.analyses.length - 1, index || 0));
  state.selectedSequence = null;
  state.highlightedStepId = null;
  state.tableLimit = TABLE_PAGE_SIZE;
  renderSessionOptions();
  resetTimelineView({ render: false });
  renderAll();
}

function renderAll() {
  const analysis = activeAnalysis();
  if (!analysis) return renderEmptyState();
  elements.workspace.setAttribute("aria-busy", "false");
  renderSessionOverview(analysis);
  renderMetrics(analysis);
  renderStepLegend(analysis);
  renderTimeline(analysis);
  renderMoments(analysis);
  renderStepDwell(analysis);
  renderJourney(analysis);
  renderRhythm(analysis);
  renderClickField(analysis);
  renderTargetMix(analysis);
  renderEventTable(analysis);
  renderQuality(analysis);
  renderCodexResults(state.codexResults.get(sessionIdFor(analysis)) || null);
  elements.exportAnalysis.disabled = false;
  elements.clearLogs.disabled = false;
}

function renderEmptyState(error = "") {
  renderSessionOptions();
  elements.sessionSubtitle.textContent = error || "No session loaded. Import a StoryVR log file.";
  for (const [key, value] of [["metricDuration", "—"], ["metricEvents", "—"], ["metricSteps", "—"], ["metricMoments", "—"]]) elements[key].textContent = value;
  elements.timelineSvg.replaceChildren(svgText(600, 150, error || "Import a log to reveal the authoring journey.", "axis-label"));
  elements.stepLegend.replaceChildren();
  elements.momentList.innerHTML = '<div class="empty-list">No key moments yet.</div>';
  elements.stepDwell.replaceChildren();
  elements.journeyPath.replaceChildren();
  elements.rhythmChart.replaceChildren();
  elements.clickField.replaceChildren();
  elements.targetMix.replaceChildren();
  elements.eventTableBody.replaceChildren();
  elements.eventTableCount.textContent = "0 events";
  elements.qualityList.innerHTML = '<div class="quality-item"><i>i</i><span>Import a StoryVR log to see what it recorded and what it missed.</span></div>';
  elements.selectedEvent.innerHTML = '<span class="selection-dot" aria-hidden="true"></span><div><strong>No click selected</strong><p>Load a session to see click details.</p></div>';
  elements.exportAnalysis.disabled = true;
  elements.clearLogs.disabled = true;
  elements.runCodex.disabled = true;
  elements.codexResults.hidden = true;
}

function renderSessionOptions() {
  elements.sessionSelect.innerHTML = state.analyses.length
    ? state.analyses.map((analysis, index) => `<option value="${index}" ${index === state.activeIndex ? "selected" : ""}>${escapeHtml(sessionOptionLabel(analysis, index))}</option>`).join("")
    : '<option value="">No session loaded</option>';
  elements.sessionSelect.disabled = !state.analyses.length;
}

function renderSessionOverview(analysis) {
  const story = sessionStory(analysis);
  const title = story.title || story.slug || "Untitled StoryVR story";
  const started = sessionStartedAt(analysis);
  const date = started ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(started)) : "time unavailable";
  elements.sessionSubtitle.textContent = `${title} · ${date} · ${analysis.fileName || "interaction log"}`;
}

function renderMetrics(analysis) {
  const duration = sessionDuration(analysis);
  const events = eventsFor(analysis).filter((event) => event.type === "click");
  const visited = visitedSteps(analysis);
  const moments = momentsFor(analysis);
  elements.metricDuration.textContent = formatDuration(duration);
  elements.metricDurationNote.textContent = duration >= 60_000 ? `${formatNumber(duration / 60_000, 1)} minutes recorded` : "Time recorded";
  elements.metricEvents.textContent = String(events.length);
  elements.metricEventsNote.textContent = `${formatRate(events.length, duration)} clicks / min`;
  elements.metricSteps.textContent = String(visited.length);
  elements.metricStepsNote.textContent = `Of ${STEPS.length} StoryVR steps`;
  elements.metricMoments.textContent = String(moments.length);
  const concernCount = moments.filter((moment) => momentValence(moment) === "concern").length;
  elements.metricMomentsNote.textContent = concernCount ? `${concernCount} need${concernCount === 1 ? "s" : ""} attention` : "Key points found in the log";
}

function renderStepLegend(analysis) {
  const visited = new Set(visitedSteps(analysis));
  elements.stepLegend.innerHTML = STEPS.map((step) => `
    <button type="button" data-step-id="${step.id}" class="${state.highlightedStepId === step.id ? "active" : ""}" aria-pressed="${state.highlightedStepId === step.id}" title="${visited.has(step.id) ? "Highlight this step" : "This step was not observed"}">
      <i style="--step-color:${stepColor(step.id)}"></i>${escapeHtml(step.label)}${visited.has(step.id) ? "" : " · not visited"}
    </button>
  `).join("");
}

function renderTimeline(analysis) {
  const duration = Math.max(1, sessionDuration(analysis));
  const start = Math.max(0, Math.min(duration, state.viewStartMs));
  const end = Math.max(start + 1, Math.min(duration, state.viewEndMs));
  const range = end - start;
  const xFor = (milliseconds) => TIMELINE_LEFT + (milliseconds - start) / range * PLOT_WIDTH;
  const svg = elements.timelineSvg;
  svg.replaceChildren();

  const defs = svgElement("defs");
  defs.innerHTML = `
    <pattern id="uncertain-pattern" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
      <rect width="8" height="8" fill="white"></rect><rect width="3" height="8" fill="#b8c2bc"></rect>
    </pattern>
    <mask id="uncertain-mask"><rect width="100%" height="100%" fill="url(#uncertain-pattern)"></rect></mask>
    <clipPath id="plot-clip"><rect x="${TIMELINE_LEFT}" y="28" width="${PLOT_WIDTH}" height="264" rx="4"></rect></clipPath>
  `;
  svg.append(defs);

  const segmentsGroup = svgElement("g", { "clip-path": "url(#plot-clip)" });
  for (const segment of segmentsFor(analysis)) {
    const segmentStart = numberOr(segment.startMs, segment.start, 0);
    const segmentEnd = numberOr(segment.endMs, segment.end, duration);
    if (segmentEnd < start || segmentStart > end) continue;
    const clippedStart = Math.max(start, segmentStart);
    const clippedEnd = Math.min(end, segmentEnd);
    const stepId = segment.stepId || segment.componentId || "unknown";
    const highlighted = !state.highlightedStepId || state.highlightedStepId === stepId;
    segmentsGroup.append(svgElement("rect", {
      class: `segment${segment.uncertain || segment.boundaryConfidence === "uncertain" || segment.startReason === "observed-context" ? " uncertain" : ""}`,
      x: xFor(clippedStart), y: 28, width: Math.max(1, xFor(clippedEnd) - xFor(clippedStart)), height: 264,
      fill: stepColor(stepId), opacity: highlighted ? 0.82 : 0.22,
    }));
    if (xFor(clippedEnd) - xFor(clippedStart) > 76) {
      const label = svgText(xFor(clippedStart) + 8, 44, stepLabel(stepId), "step-label");
      if (!highlighted) label.setAttribute("opacity", "0.45");
      segmentsGroup.append(label);
    }
  }
  svg.append(segmentsGroup);

  const tickCount = range < 20_000 ? 5 : 7;
  for (let index = 0; index <= tickCount; index += 1) {
    const time = start + range * index / tickCount;
    const x = xFor(time);
    svg.append(svgElement("line", { x1: x, y1: 28, x2: x, y2: 292, class: "grid-line" }));
    const label = svgText(x, 18, formatTimelineTick(time, range), "axis-label");
    label.setAttribute("text-anchor", index === 0 ? "start" : index === tickCount ? "end" : "middle");
    svg.append(label);
  }
  for (const y of [100, 172, 244]) svg.append(svgElement("line", { x1: TIMELINE_LEFT, y1: y, x2: TIMELINE_WIDTH - TIMELINE_RIGHT, y2: y, class: "lane-line" }));

  const visibleEvents = sampledVisibleEvents(eventsFor(analysis), start, end, MAX_TIMELINE_EVENTS);
  const eventGroup = svgElement("g", { "clip-path": "url(#plot-clip)" });
  for (const event of visibleEvents) {
    const stepId = stepIdForEvent(event);
    const highlighted = !state.highlightedStepId || state.highlightedStepId === stepId;
    const x = xFor(eventElapsed(event));
    const semantic = Boolean(event.target?.semantic);
    const lifecycle = event.type !== "click";
    const laneBase = lifecycle ? 204 : semantic ? 132 : 61;
    const y = laneBase + ((Number(event.sequence) || 0) % 5 - 2) * 4;
    const selected = Number(event.sequence) === Number(state.selectedSequence);
    const wrapper = svgElement("g", {
      class: "event-marker",
      "data-event-sequence": event.sequence,
      "data-tooltip": tooltipForEvent(event),
      opacity: highlighted ? 1 : 0.18,
      role: "button",
      tabindex: "0",
      "aria-label": `${formatDuration(eventElapsed(event))}, ${stepLabel(stepId)}, ${eventLabel(event)}`,
    });
    wrapper.append(svgElement("circle", { class: "event-hit", cx: x, cy: y, r: 10, fill: "transparent" }));
    if (semantic) {
      wrapper.append(svgElement("rect", { class: "event-shape", x: x - 4.2, y: y - 4.2, width: 8.4, height: 8.4, rx: 1, fill: "#b7533f", stroke: selected ? "#13251f" : "white", "stroke-width": selected ? 2.4 : 1.2, transform: `rotate(45 ${x} ${y})` }));
    } else if (lifecycle) {
      wrapper.append(svgElement("rect", { class: "event-shape", x: x - 4, y: y - 4, width: 8, height: 8, rx: 2, fill: "#6d7b75", stroke: selected ? "#13251f" : "white", "stroke-width": selected ? 2.4 : 1.2 }));
    } else {
      wrapper.append(svgElement("circle", { class: "event-shape", cx: x, cy: y, r: selected ? 5.4 : 4.1, fill: "#147b6d", stroke: selected ? "#13251f" : "white", "stroke-width": selected ? 2.4 : 1.2 }));
    }
    eventGroup.append(wrapper);
  }
  svg.append(eventGroup);

  const momentGroup = svgElement("g", { "clip-path": "url(#plot-clip)" });
  let previousMomentX = Number.NEGATIVE_INFINITY;
  let momentCollisionLevel = 0;
  for (const moment of momentsFor(analysis)) {
    const at = momentStart(moment);
    if (at < start || at > end) continue;
    const valence = momentValence(moment);
    const color = valence === "good" ? "#238461" : valence === "concern" ? "#c44955" : "#c58a2f";
    const x = xFor(at);
    momentCollisionLevel = x - previousMomentX < 16 ? (momentCollisionLevel + 1) % 3 : 0;
    previousMomentX = x;
    const markerY = 178 + momentCollisionLevel * 19;
    momentGroup.append(svgElement("line", { class: "moment-stem", x1: x, y1: markerY + 1, x2: x, y2: 232, stroke: color, opacity: 0.72 }));
    const marker = svgElement("path", {
      d: `M ${x} ${markerY} l -6 -10 h 12 z`, fill: color, stroke: "white", "stroke-width": 1.2,
      class: "event-marker", tabindex: "0", role: "button", "data-moment-id": moment.id,
      "data-tooltip": `${moment.title || "Analysis moment"} · ${formatDuration(at)}`,
      "aria-label": `${valence}, ${moment.title || "analysis moment"}, ${formatDuration(at)}`,
    });
    momentGroup.append(marker);
  }
  svg.append(momentGroup);

  const bins = activityBinsFor(analysis, start, end);
  const maxCount = Math.max(1, ...bins.map(activityBinCount));
  const activityGroup = svgElement("g", { "clip-path": "url(#plot-clip)" });
  for (const bin of bins) {
    const binStart = numberOr(bin.startMs, bin.start, start);
    const binEnd = numberOr(bin.endMs, bin.end, binStart + range / Math.max(1, bins.length));
    const binCount = activityBinCount(bin);
    const height = Math.max(2, binCount / maxCount * 38);
    activityGroup.append(svgElement("rect", {
      class: `activity-bar${binCount >= maxCount * 0.78 ? " hot" : ""}`,
      x: xFor(binStart) + 1, y: 290 - height, width: Math.max(2, xFor(binEnd) - xFor(binStart) - 2), height,
      rx: 2,
    }));
  }
  svg.append(activityGroup);
  updateTimelineWindowControls(analysis);
}

function renderMoments(analysis) {
  const all = momentsFor(analysis);
  const visible = state.momentFilter === "all" ? all : all.filter((moment) => momentValence(moment) === state.momentFilter);
  elements.momentCount.textContent = String(visible.length);
  elements.momentList.innerHTML = visible.length ? visible.map((moment) => {
    const valence = momentValence(moment);
    return `
      <button class="moment-card" type="button" data-moment-id="${escapeHtml(moment.id)}">
        <i class="moment-valence ${valence}" aria-hidden="true"></i>
        <span><strong>${escapeHtml(moment.title || capitalize(valence))}</strong><p>${escapeHtml(moment.description || moment.summary || "A possible key moment in this session")}</p></span>
        <time>${formatDuration(momentStart(moment))}</time>
      </button>
    `;
  }).join("") : `<div class="empty-list">No ${state.momentFilter === "all" ? "" : `${state.momentFilter} `}moments in this session.</div>`;
}

function renderStepDwell(analysis) {
  const duration = Math.max(1, sessionDuration(analysis));
  const metrics = stepMetricsFor(analysis);
  elements.stepDwell.innerHTML = metrics.length ? metrics.map((metric) => {
    const stepId = metric.stepId || metric.componentId || "unknown";
    const dwell = numberOr(metric.durationMs, metric.dwellMs, metric.timeMs, 0);
    const share = Number.isFinite(Number(metric.share)) ? Number(metric.share) * (Number(metric.share) <= 1 ? 100 : 1) : dwell / duration * 100;
    return `<div class="dwell-row"><span class="dwell-label" title="${escapeHtml(stepLabel(stepId))}">${escapeHtml(stepLabel(stepId))}</span><span class="dwell-track"><i style="--share:${Math.min(100, share)}%;--step-color:${stepColor(stepId)}"></i></span><span class="dwell-time">${formatDuration(dwell)}</span></div>`;
  }).join("") : '<div class="empty-list">No time-by-step data.</div>';
}

function renderJourney(analysis) {
  const nodes = journeyFor(analysis);
  if (!nodes.length) {
    elements.journeyPath.innerHTML = '<span class="event-target">No clear step path.</span>';
    return;
  }
  elements.journeyPath.innerHTML = nodes.map((node, index) => {
    const stepId = typeof node === "string" ? node : node.stepId || node.componentId || "unknown";
    const previous = index ? (typeof nodes[index - 1] === "string" ? nodes[index - 1] : nodes[index - 1].stepId || nodes[index - 1].componentId) : null;
    const backward = previous && stepIndex(stepId) < stepIndex(previous);
    const arrow = index ? `<span class="journey-arrow ${backward ? "backward" : ""}" aria-label="${backward ? "backward transition" : "forward transition"}">${backward ? "↶" : "→"}</span>` : "";
    return `<span class="journey-hop">${arrow}<span class="journey-node" style="--step-color:${stepColor(stepId)}">${escapeHtml(shortStepLabel(stepId))}</span></span>`;
  }).join("");
}

function renderRhythm(analysis) {
  const bins = activityBinsFor(analysis, 0, sessionDuration(analysis));
  const max = Math.max(1, ...bins.map(activityBinCount));
  const pauseMoments = momentsFor(analysis).filter((moment) => /pause|idle|quiet/i.test(`${moment.kind || ""} ${moment.title || ""}`));
  elements.rhythmSummary.textContent = `${bins.reduce((sum, bin) => sum + activityBinCount(bin), 0)} clicks · ${pauseMoments.length} pause${pauseMoments.length === 1 ? "" : "s"}`;
  elements.rhythmChart.innerHTML = bins.length ? bins.map((bin) => {
    const count = activityBinCount(bin);
    const stepId = bin.dominantStepId || bin.stepId || bin.componentId || "unknown";
    return `<i class="rhythm-bin ${bin.isPause ? "pause" : ""}" style="--height:${Math.max(3, count / max * 100)}%;--step-color:${stepColor(stepId)}" data-label="${escapeHtml(`${formatDuration(numberOr(bin.startMs, bin.start, 0))}: ${count} clicks`)}"></i>`;
  }).join("") : '<div class="empty-list">Not enough timing data.</div>';
}

function renderClickField(analysis) {
  const viewport = sessionViewport(analysis);
  const width = Number(viewport.width);
  const height = Number(viewport.height);
  const events = eventsFor(analysis).filter((event) => event.type === "click" && Number.isFinite(Number(event.pointer?.clientX)) && Number.isFinite(Number(event.pointer?.clientY)));
  if (!events.length || !(width > 0 && height > 0)) {
    elements.clickField.innerHTML = '<div class="empty-list">Viewport click coordinates unavailable.</div>';
    elements.clickmapSummary.textContent = "No coordinates";
    return;
  }
  const sampled = evenlySample(events, 180);
  elements.clickField.innerHTML = sampled.map((event) => {
    const x = clamp(Number(event.pointer.clientX) / width * 100, 0, 100);
    const y = clamp(Number(event.pointer.clientY) / height * 100, 0, 100);
    const semantic = Boolean(event.target?.semantic);
    return `<i class="click-dot ${semantic ? "semantic" : ""}" style="--x:${x}%;--y:${y}%;--step-color:${stepColor(stepIdForEvent(event))}" title="${escapeHtml(`${formatDuration(eventElapsed(event))} · ${eventLabel(event)}`)}"></i>`;
  }).join("");
  elements.clickmapSummary.textContent = `${events.length} positioned`;
}

function renderTargetMix(analysis) {
  const clicks = eventsFor(analysis).filter((event) => event.type === "click");
  const semantic = clicks.filter((event) => event.target?.semantic).length;
  const unknown = clicks.filter((event) => !event.target || ["unknown", "canvas"].includes(String(event.target.kind || "").toLowerCase()) && !event.target?.semantic).length;
  const dom = Math.max(0, clicks.length - semantic - unknown);
  const total = Math.max(1, clicks.length);
  const topTargets = targetStatsFor(analysis).slice(0, 5);
  elements.targetMix.innerHTML = `
    <div class="target-ring-wrap">
      <div class="target-ring" style="--dom-share:${dom / total * 100}%;--semantic-share:${semantic / total * 100}%" data-total="${clicks.length}"></div>
      <div class="target-legend">
        <span><span><i style="--color:var(--teal)"></i>Interface</span><b>${dom}</b></span>
        <span><span><i style="--color:var(--coral)"></i>Named 3D controls</span><b>${semantic}</b></span>
        <span><span><i style="--color:#c9d1cc"></i>Unknown / canvas</span><b>${unknown}</b></span>
      </div>
    </div>
    <div class="top-targets">
      <h3>Most repeated targets</h3>
      ${topTargets.length ? topTargets.map((target) => `<div class="top-target-row"><span title="${escapeHtml(target.label || target.key || "Unknown item")}">${escapeHtml(target.label || target.key || "Unknown item")}</span><b>${Number(target.count) || 0}</b></div>`).join("") : '<span class="event-target">No repeated clicks.</span>'}
    </div>
  `;
}

function renderEventTable(analysis) {
  const query = elements.eventSearch.value.trim().toLowerCase();
  const stepFilter = elements.eventStepFilter.value || "all";
  const events = eventsFor(analysis).filter((event) => {
    if (stepFilter !== "all" && stepIdForEvent(event) !== stepFilter) return false;
    if (!query) return true;
    return eventSearchText(event).includes(query);
  });
  const visible = events.slice(0, state.tableLimit);
  elements.eventTableBody.innerHTML = visible.map((event) => {
    const stepId = stepIdForEvent(event);
    const semantic = event.target?.semantic;
    const signal = momentForSequence(analysis, event.sequence);
    return `
      <tr data-event-sequence="${Number(event.sequence) || 0}" class="${Number(event.sequence) === Number(state.selectedSequence) ? "selected" : ""}" tabindex="0">
        <td class="event-time">${formatDuration(eventElapsed(event))}</td>
        <td><span class="step-chip" style="--step-color:${stepColor(stepId)}">${escapeHtml(shortStepLabel(stepId))}</span></td>
        <td class="event-action"><strong>${escapeHtml(eventLabel(event))}</strong><small>#${Number(event.sequence) || "—"} · ${escapeHtml(event.type || "event")}</small></td>
        <td class="event-target">${escapeHtml(semantic?.label || editorSceneLabel(event) || event.target?.locator || "—")}</td>
        <td>${signal ? `<span class="signal-chip"><i class="${momentValence(signal)}"></i>${escapeHtml(signal.title || capitalize(momentValence(signal)))}</span>` : "—"}</td>
      </tr>
    `;
  }).join("");
  elements.eventTableCount.textContent = `${Math.min(visible.length, events.length)} of ${events.length} event${events.length === 1 ? "" : "s"}`;
  elements.showMoreEvents.hidden = visible.length >= events.length;
}

function renderQuality(analysis) {
  const warnings = qualityWarningsFor(analysis);
  const base = [
    "The log records clicks and some 3D actions. It does not record typing, scrolling, hovering, or how long a drag lasted.",
    "A pause can mean reading, thinking, an interruption, or a problem. The log cannot tell which one.",
    "The log checks the current step only when a click happens. A step change is exact only when the next click confirms it.",
    "The screen size is saved only at the start, so click positions may be less accurate after a resize.",
  ];
  const items = [...new Set([...warnings, ...base])].slice(0, 8);
  elements.qualityList.innerHTML = items.map((item, index) => `<div class="quality-item"><i>${index < warnings.length ? "!" : "i"}</i><span>${escapeHtml(typeof item === "string" ? item : item.message || item.summary || String(item))}</span></div>`).join("");
}

async function refreshCodexStatus() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || `HTTP ${response.status}`);
    state.codexStatus = status;
    const available = Boolean(status.authenticated ?? status.codexAuthenticated ?? status.available);
    elements.codexStatus.classList.toggle("unavailable", !available);
    elements.codexStatus.innerHTML = `<i></i><span>${escapeHtml(available ? `Codex ready${status.version ? ` · ${status.version}` : ""}` : status.message || status.authText || "Codex is not signed in")}</span>`;
    elements.runCodex.disabled = !available || !activeAnalysis();
  } catch (error) {
    state.codexStatus = { available: false };
    elements.codexStatus.classList.add("unavailable");
    elements.codexStatus.innerHTML = `<i></i><span>Codex unavailable · ${escapeHtml(error.message)}</span>`;
    elements.runCodex.disabled = true;
  }
}

async function runCodexAnalysis() {
  const analysis = activeAnalysis();
  if (!analysis) return;
  elements.runCodex.disabled = true;
  elements.runCodex.textContent = "Reviewing session…";
  elements.codexStatus.classList.add("running");
  elements.codexStatus.innerHTML = "<i></i><span>Codex is reviewing a short log summary…</span>";
  try {
    const digest = buildCodexEvidence([analysis]);
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ digest }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Analysis returned HTTP ${response.status}.`);
    const codex = result.analysis || result;
    state.codexResults.set(sessionIdFor(analysis), codex);
    renderCodexResults(codex);
    elements.codexStatus.innerHTML = `<i></i><span>Codex review complete${codex.engine?.version ? ` · ${escapeHtml(codex.engine.version)}` : ""}</span>`;
    showToast("Codex review added to the current session.");
  } catch (error) {
    elements.codexStatus.classList.add("unavailable");
    elements.codexStatus.innerHTML = `<i></i><span>Codex review failed · ${escapeHtml(error.message)}</span>`;
    showToast(`Codex review failed: ${error.message}`, 6500);
  } finally {
    elements.codexStatus.classList.remove("running");
    elements.runCodex.textContent = "Review current session";
    elements.runCodex.disabled = !(state.codexStatus?.authenticated ?? state.codexStatus?.codexAuthenticated ?? state.codexStatus?.available);
  }
}

function renderCodexResults(result) {
  if (!result) {
    elements.codexResults.hidden = true;
    elements.codexResults.replaceChildren();
    elements.runCodex.disabled = !(state.codexStatus?.authenticated ?? state.codexStatus?.codexAuthenticated ?? state.codexStatus?.available) || !activeAnalysis();
    return;
  }
  const overview = result.overview || result.summary || {};
  const headline = typeof overview === "string" ? "Codex session review" : overview.headline || overview.title || "Codex session review";
  const summary = typeof overview === "string" ? overview : overview.summary || overview.description || "Codex found a few points to review.";
  const moments = Array.isArray(result.moments) ? result.moments.slice(0, 6) : [];
  elements.codexResults.innerHTML = `
    <article class="codex-summary-card"><strong>${escapeHtml(headline)}</strong><p>${escapeHtml(summary)}</p></article>
    <div class="codex-moments">
      ${moments.length ? moments.map((moment) => `<article class="codex-moment-card"><header><strong>${escapeHtml(moment.title || capitalize(moment.valence || "moment"))}</strong><time>${formatDuration(numberOr(moment.startMs, moment.atMs, 0))}</time></header><p>${escapeHtml(moment.description || moment.interpretation || moment.summary || "Evidence-linked observation")}</p></article>`).join("") : '<article class="codex-moment-card"><p>No additional moments were returned.</p></article>'}
    </div>
  `;
  elements.codexResults.hidden = false;
}

function handleTimelineActivation(event) {
  const momentMarker = event.target.closest?.("[data-moment-id]");
  if (momentMarker) {
    const moment = momentsFor(activeAnalysis()).find((candidate) => candidate.id === momentMarker.dataset.momentId);
    if (moment) focusMoment(moment);
    return;
  }
  const marker = event.target.closest?.("[data-event-sequence]");
  if (marker) selectEvent(Number(marker.dataset.eventSequence));
}

function showTimelineTooltip(event) {
  const target = event.target.closest?.("[data-tooltip]");
  if (!target) return hideTimelineTooltip();
  elements.timelineTooltip.innerHTML = `<strong>${escapeHtml(target.dataset.tooltip.split(" · ")[0])}</strong>${escapeHtml(target.dataset.tooltip.split(" · ").slice(1).join(" · "))}`;
  const wrapRect = elements.timelineSvg.parentElement.getBoundingClientRect();
  elements.timelineTooltip.style.left = `${clamp(event.clientX - wrapRect.left + 12, 8, wrapRect.width - 260)}px`;
  elements.timelineTooltip.style.top = `${clamp(event.clientY - wrapRect.top - 50, 8, 245)}px`;
  elements.timelineTooltip.hidden = false;
}

function hideTimelineTooltip() {
  elements.timelineTooltip.hidden = true;
}

function selectEvent(sequence, { focusTimeline = false } = {}) {
  const analysis = activeAnalysis();
  const event = eventsFor(analysis).find((candidate) => Number(candidate.sequence) === Number(sequence));
  if (!event) return;
  state.selectedSequence = Number(sequence);
  if (focusTimeline && (eventElapsed(event) < state.viewStartMs || eventElapsed(event) > state.viewEndMs)) {
    const width = Math.max(5_000, state.viewEndMs - state.viewStartMs);
    setTimelineWindow(eventElapsed(event) - width / 2, eventElapsed(event) + width / 2, { render: false });
  }
  const stepId = stepIdForEvent(event);
  const semantic = event.target?.semantic;
  const scene = editorSceneLabel(event);
  elements.selectedEvent.innerHTML = `<span class="selection-dot" aria-hidden="true" style="background:${stepColor(stepId)};box-shadow:0 0 0 2px ${stepColor(stepId)}"></span><div><strong>${escapeHtml(eventLabel(event))} · ${formatDuration(eventElapsed(event))} · click #${Number(event.sequence) || "—"}</strong><p>${escapeHtml(stepLabel(stepId))}${scene ? ` · ${escapeHtml(scene)}` : ""}${semantic ? ` · 3D item: ${escapeHtml(semantic.label || semantic.kind)}` : ""}</p></div>`;
  renderTimeline(analysis);
  renderEventTable(analysis);
}

function focusMoment(moment) {
  const analysis = activeAnalysis();
  const start = momentStart(moment);
  const end = numberOr(moment.endMs, moment.atMs, start + 1);
  const padding = Math.max(4_000, (end - start) * 2.5);
  setTimelineWindow(start - padding, end + padding, { render: false });
  const sequence = momentSequences(moment)[0];
  if (sequence != null) selectEvent(Number(sequence));
  else renderTimeline(analysis);
  elements.timelineSvg.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetTimelineView({ render = true } = {}) {
  const analysis = activeAnalysis();
  const duration = Math.max(1, sessionDuration(analysis));
  state.viewStartMs = 0;
  state.viewEndMs = duration;
  if (render && analysis) renderTimeline(analysis);
}

function zoomTimeline(factor, center = (state.viewStartMs + state.viewEndMs) / 2) {
  const analysis = activeAnalysis();
  if (!analysis) return;
  const duration = sessionDuration(analysis);
  const minimum = Math.min(duration, Math.max(3_000, duration * 0.025));
  const width = clamp((state.viewEndMs - state.viewStartMs) * factor, minimum, duration);
  setTimelineWindow(center - width / 2, center + width / 2);
}

function panTimeline(fraction) {
  const width = state.viewEndMs - state.viewStartMs;
  const shift = width * fraction;
  setTimelineWindow(state.viewStartMs + shift, state.viewEndMs + shift);
}

function setTimelineWindow(start, end, { render = true } = {}) {
  const analysis = activeAnalysis();
  if (!analysis) return;
  const duration = Math.max(1, sessionDuration(analysis));
  let width = Math.max(1, end - start);
  width = Math.min(duration, width);
  let nextStart = start;
  if (nextStart < 0) nextStart = 0;
  if (nextStart + width > duration) nextStart = duration - width;
  state.viewStartMs = Math.max(0, nextStart);
  state.viewEndMs = Math.min(duration, state.viewStartMs + width);
  if (render) renderTimeline(analysis);
}

function updateTimelineWindowControls(analysis) {
  const duration = Math.max(1, sessionDuration(analysis));
  const center = (state.viewStartMs + state.viewEndMs) / 2;
  elements.timelineScrubber.value = String(Math.round(center / duration * 1000));
  const full = state.viewStartMs <= 1 && state.viewEndMs >= duration - 1;
  elements.windowLabel.textContent = full ? "Full session" : `${formatDuration(state.viewStartMs)}–${formatDuration(state.viewEndMs)}`;
  elements.timelineScrubber.disabled = full;
  elements.panLeft.disabled = state.viewStartMs <= 0;
  elements.panRight.disabled = state.viewEndMs >= duration;
  elements.zoomOut.disabled = full;
}

function timelineMsAtClientX(clientX) {
  const rect = elements.timelineSvg.getBoundingClientRect();
  const normalized = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  return state.viewStartMs + normalized * (state.viewEndMs - state.viewStartMs);
}

function downloadDerivedAnalysis() {
  const analysis = activeAnalysis();
  if (!analysis) return;
  const exportPayload = {
    schemaVersion: "storyvr-workflow-lens-export/v1",
    exportedAt: new Date().toISOString(),
    source: {
      sessionId: sessionIdFor(analysis),
      fileName: analysis.fileName || null,
      originalSchemaVersion: analysis.session?.schemaVersion || analysis.schemaVersion || "storyvr-interaction-log/v1",
    },
    analysis,
    codexAnalysis: state.codexResults.get(sessionIdFor(analysis)) || null,
  };
  const blob = new Blob([`${JSON.stringify(exportPayload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `storyvr-workflow-analysis-${safeFileToken(sessionIdFor(analysis))}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function activeAnalysis() {
  return state.analyses[state.activeIndex] || null;
}

function eventsFor(analysis) {
  return Array.isArray(analysis?.events) ? analysis.events : Array.isArray(analysis?.session?.events) ? analysis.session.events : [];
}

function segmentsFor(analysis) {
  const segments = analysis?.timeline?.segments || analysis?.segments || analysis?.stepSegments || [];
  if (Array.isArray(segments) && segments.length) return segments;
  const events = eventsFor(analysis);
  const duration = sessionDuration(analysis);
  if (!events.length) return [{ stepId: "unknown", startMs: 0, endMs: duration }];
  const derived = [];
  for (const event of events) {
    const stepId = stepIdForEvent(event);
    const previous = derived.at(-1);
    if (!previous || previous.stepId !== stepId) {
      if (previous) previous.endMs = eventElapsed(event);
      derived.push({ stepId, startMs: eventElapsed(event), endMs: duration, uncertain: true });
    }
  }
  return derived;
}

function momentsFor(analysis) {
  const moments = analysis?.moments || analysis?.heuristicMoments || [];
  return Array.isArray(moments) ? moments : [];
}

function stepMetricsFor(analysis) {
  const metrics = analysis?.stepDwell || analysis?.stepMetrics || analysis?.steps || [];
  if (Array.isArray(metrics)) return metrics.filter((metric) => numberOr(metric.durationMs, metric.dwellMs, metric.timeMs, 0) > 0);
  if (metrics && typeof metrics === "object") return Object.entries(metrics).map(([stepId, value]) => ({ stepId, ...(typeof value === "object" ? value : { durationMs: value }) })).filter((metric) => numberOr(metric.durationMs, metric.dwellMs, 0) > 0);
  const totals = new Map();
  for (const segment of segmentsFor(analysis)) {
    const stepId = segment.stepId || segment.componentId || "unknown";
    totals.set(stepId, (totals.get(stepId) || 0) + Math.max(0, numberOr(segment.endMs, segment.end, 0) - numberOr(segment.startMs, segment.start, 0)));
  }
  return [...totals].map(([stepId, durationMs]) => ({ stepId, durationMs }));
}

function journeyFor(analysis) {
  if (Array.isArray(analysis?.journey)) return analysis.journey;
  if (Array.isArray(analysis?.journey?.visitStepIds)) return analysis.journey.visitStepIds;
  if (Array.isArray(analysis?.transitions) && analysis.transitions.length) {
    const transitions = analysis.transitions;
    return [transitions[0].fromStepId || transitions[0].from, ...transitions.map((transition) => transition.toStepId || transition.to)].filter(Boolean);
  }
  return segmentsFor(analysis).map((segment) => segment.stepId || segment.componentId || "unknown");
}

function activityBinsFor(analysis, start, end) {
  const supplied = analysis?.timeline?.activityBins || analysis?.activityBins || analysis?.rhythmBins;
  if (Array.isArray(supplied) && supplied.length) return supplied.filter((bin) => numberOr(bin.endMs, bin.end, end) >= start && numberOr(bin.startMs, bin.start, start) <= end);
  const events = eventsFor(analysis).filter((event) => eventElapsed(event) >= start && eventElapsed(event) <= end && event.type === "click");
  const count = Math.min(72, Math.max(12, Math.ceil(Math.sqrt(Math.max(1, events.length)) * 3)));
  const width = Math.max(1, (end - start) / count);
  const bins = Array.from({ length: count }, (_, index) => ({ startMs: start + index * width, endMs: start + (index + 1) * width, count: 0, stepId: "unknown" }));
  for (const event of events) {
    const index = Math.min(count - 1, Math.floor((eventElapsed(event) - start) / width));
    bins[index].count += 1;
    bins[index].stepId = stepIdForEvent(event);
  }
  return bins;
}

function targetStatsFor(analysis) {
  const supplied = analysis?.stats?.topTargets || analysis?.targetStats?.topTargets || analysis?.topTargets || (Array.isArray(analysis?.targetStats) ? analysis.targetStats : null);
  if (Array.isArray(supplied)) return supplied;
  const counts = new Map();
  for (const event of eventsFor(analysis).filter((candidate) => candidate.type === "click")) {
    const label = event.target?.semantic?.label || event.target?.label || event.target?.locator || "Unknown target";
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts].map(([label, count]) => ({ label, count })).sort((left, right) => right.count - left.count);
}

function qualityWarningsFor(analysis) {
  const supplied = analysis?.quality?.warnings || analysis?.qualityWarnings || analysis?.warnings || [];
  return Array.isArray(supplied) ? supplied : [];
}

function sessionDuration(analysis) {
  const direct = numberOr(analysis?.session?.durationMs, analysis?.durationMs, analysis?.log?.durationMs);
  if (direct != null && direct >= 0) return direct;
  const events = eventsFor(analysis);
  return Math.max(1, ...events.map(eventElapsed));
}

function sessionIdFor(analysis) {
  return String(analysis?.source?.sessionId || analysis?.session?.sessionId || analysis?.session?.id || analysis?.sessionId || analysis?.id || "session");
}

function sessionStartedAt(analysis) {
  return analysis?.source?.startedAt || analysis?.session?.startedAt || analysis?.startedAt || null;
}

function sessionStory(analysis) {
  return analysis?.session?.story || analysis?.session?.sessionContext?.story || analysis?.session?.context?.story || analysis?.sessionContext?.story || analysis?.story || {};
}

function sessionViewport(analysis) {
  return analysis?.session?.viewport || analysis?.viewport || {};
}

function visitedSteps(analysis) {
  return [...new Set(segmentsFor(analysis).map((segment) => segment.stepId || segment.componentId).filter((id) => id && id !== "unknown"))];
}

function stepIdForEvent(event) {
  return event.effectiveStepId || event.stepId || event.componentId || event.context?.workspace?.componentId || "unknown";
}

function eventElapsed(event) {
  return Math.max(0, numberOr(event.elapsedMs, event.atMs, 0));
}

function eventLabel(event) {
  if (event.type !== "click") return lifecycleLabel(event.type);
  return event.target?.semantic?.label || event.target?.label || event.target?.data?.action || event.target?.kind || "Unknown click target";
}

function lifecycleLabel(type) {
  return String(type || "system event").split("-").map(capitalize).join(" ");
}

function editorSceneLabel(event) {
  const scene = event.editorScene || event.context?.workspace?.editorScene;
  if (!scene) return "";
  return scene.beatId || scene.sceneKey || scene.targetId || scene.kind || scene.type || "Scene editor";
}

function momentValence(moment) {
  const value = String(moment?.valence || moment?.type || moment?.category || "watch").toLowerCase();
  if (["good", "positive", "success"].includes(value)) return "good";
  if (["bad", "negative", "friction", "concern", "needs-attention", "error"].includes(value)) return "concern";
  return "watch";
}

function momentStart(moment) {
  return Math.max(0, numberOr(moment?.startMs, moment?.atMs, moment?.elapsedMs, 0));
}

function momentSequences(moment) {
  const direct = moment?.eventSequences || moment?.sequences;
  if (Array.isArray(direct)) return direct.map(Number).filter(Number.isFinite);
  if (Array.isArray(moment?.evidence)) {
    return moment.evidence.map((entry) => Number(entry?.sequence ?? entry)).filter(Number.isFinite);
  }
  return [];
}

function momentForSequence(analysis, sequence) {
  return momentsFor(analysis).find((moment) => momentSequences(moment).includes(Number(sequence)));
}

function tooltipForEvent(event) {
  const semantic = event.target?.semantic;
  return `${eventLabel(event)} · ${formatDuration(eventElapsed(event))} · ${stepLabel(stepIdForEvent(event))}${semantic ? " · 3D item" : ""}`;
}

function eventSearchText(event) {
  return [
    event.type,
    stepIdForEvent(event),
    stepLabel(stepIdForEvent(event)),
    eventLabel(event),
    editorSceneLabel(event),
    event.target?.kind,
    event.target?.locator,
    event.target?.semantic?.kind,
    event.target?.semantic?.id,
    event.target?.semantic?.assetId,
  ].filter(Boolean).join(" ").toLowerCase();
}

function sampledVisibleEvents(events, start, end, maximum) {
  const visible = events.filter((event) => eventElapsed(event) >= start && eventElapsed(event) <= end);
  return evenlySample(visible, maximum);
}

function activityBinCount(bin) {
  return Math.max(0, numberOr(bin?.count, bin?.clickCount, bin?.eventCount, 0));
}

function evenlySample(values, maximum) {
  if (values.length <= maximum) return values;
  const sampled = [];
  const stride = (values.length - 1) / (maximum - 1);
  for (let index = 0; index < maximum; index += 1) sampled.push(values[Math.round(index * stride)]);
  return sampled;
}

function sessionOptionLabel(analysis, index) {
  const story = sessionStory(analysis);
  const label = story.title || story.slug || analysis.fileName || `Session ${index + 1}`;
  return `${label} · ${formatDuration(sessionDuration(analysis))}`;
}

function normalizedStepDefinitions(value) {
  const definitions = Array.isArray(value) && value.length ? value : FALLBACK_STEPS;
  const byId = new Map(definitions.map((step) => [step.id, step]));
  return FALLBACK_STEPS.map((fallback) => ({ ...fallback, ...(byId.get(fallback.id) || {}) }));
}

function stepLabel(stepId) {
  return STEP_BY_ID.get(stepId)?.label || titleFromId(stepId || "unknown");
}

function shortStepLabel(stepId) {
  const labels = {
    "environment-enhancement": "Environment",
    "attention-guidance": "Attention",
    "dynamic-geometry": "Dynamics",
    "inter-beat-dynamics": "Transition",
    "interaction-control": "Interaction",
    "transition-pacing": "Final Review",
  };
  return labels[stepId] || stepLabel(stepId);
}

function stepColor(stepId) {
  return STEP_COLORS[stepId] || STEP_COLORS.unknown;
}

function stepIndex(stepId) {
  return STEP_BY_ID.get(stepId)?.index ?? Number.MAX_SAFE_INTEGER;
}

function populateStepFilter() {
  elements.eventStepFilter.innerHTML = `<option value="all">All steps</option>${STEPS.map((step) => `<option value="${step.id}">${escapeHtml(step.label)}</option>`).join("")}`;
}

function formatDuration(milliseconds) {
  const value = Math.max(0, Number(milliseconds) || 0);
  if (value < 1_000) return `${Math.round(value)}ms`;
  const seconds = Math.floor(value / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function formatTimelineTick(milliseconds, range) {
  if (range < 10_000) return `${formatNumber(milliseconds / 1_000, 1)}s`;
  return formatDuration(milliseconds);
}

function formatRate(count, durationMs) {
  if (!(durationMs > 0)) return "0";
  return formatNumber(count / durationMs * 60_000, 1);
}

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(Number(value) || 0);
}

function numberOr(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value != null) element.setAttribute(key, String(value));
  }
  return element;
}

function svgText(x, y, text, className) {
  const element = svgElement("text", { x, y, class: className });
  element.textContent = text;
  return element;
}

function showToast(message, duration = 4000) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => { elements.toast.hidden = true; }, duration);
}

function hasFileDrag(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files");
}

function safeFileToken(value) {
  return String(value || "session").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "session";
}

function titleFromId(value) {
  return String(value || "unknown").split(/[-_]/).map(capitalize).join(" ");
}

function capitalize(value) {
  const text = String(value || "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function camelId(id) {
  return id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
