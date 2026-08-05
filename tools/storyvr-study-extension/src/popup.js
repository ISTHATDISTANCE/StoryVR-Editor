const studyName = document.querySelector("[data-study-name]");
const statusValue = document.querySelector("[data-collection-status]");
const statusNote = document.querySelector("[data-status-note]");
const statusDot = document.querySelector("[data-status-dot]");
const pageCard = document.querySelector("[data-page-card]");
const pageValue = document.querySelector("[data-page-status]");
const pageDisplay = document.querySelector("[data-page-display]");
const pageNote = document.querySelector("[data-page-note]");
const approvalPanel = document.querySelector("[data-approval-panel]");
const revokePanel = document.querySelector("[data-revoke-panel]");
const consentConfirmed = document.querySelector("[data-consent-confirmed]");
const controlLabelRow = document.querySelector("[data-control-label-row]");
const captureControlLabels = document.querySelector("[data-capture-control-labels]");
const approveButton = document.querySelector("[data-approve-page]");
const revokeButton = document.querySelector("[data-revoke-page]");
const actionStatus = document.querySelector("[data-page-action-status]");

let currentTabId = null;
let currentTab = null;
let actionPending = false;

approveButton.addEventListener("click", approveCurrentPage);
revokeButton.addEventListener("click", revokeCurrentPage);
consentConfirmed.addEventListener("change", updateApprovalButton);

initialize().catch(showInitializationError);

async function initialize() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = Number.isInteger(tabs[0]?.id) ? tabs[0].id : null;
  await refreshStatus();
}

async function refreshStatus() {
  const status = await chrome.runtime.sendMessage({
    type: "popup-status",
    tabId: currentTabId,
  });
  if (!status?.ok) throw new Error(responseError(status, "The extension service is unavailable."));
  studyName.textContent = status.displayName || status.studyConfigId || "Configured StoryVR study";
  setCollectionStatus(status.status || "off");
  renderCurrentTab(status.currentTab);
}

function setCollectionStatus(status) {
  const states = {
    off: ["Collection is off", "Turn it on in StoryVR to choose a folder and start a new data file."],
    collecting: ["Collection is on", "StoryVR checkpoints the named JSON file in the selected folder while you work."],
    "checkpoint-prepared": ["Writing checkpoint", "StoryVR is updating the JSON file in the folder selected at the start."],
    "stop-requested": ["Collection is off", "StoryVR is finishing the JSON file at the moment the switch was turned off."],
    prepared: ["Finalizing data", "StoryVR is completing the same JSON file without another location chooser."],
    saved: ["Collection is off", "The data file was finalized in its selected folder."],
    "limit-reached": ["Collection is paused", "Return to StoryVR so it can retry the checkpoint in the selected folder."],
    error: ["Extension unavailable", "Reload the extension and try again."],
  };
  const [label, note] = states[status] || states.off;
  statusValue.textContent = label;
  statusNote.textContent = note;
  statusDot.dataset.state = status;
}

function renderCurrentTab(value) {
  currentTab = value && typeof value === "object"
    ? value
    : { kind: "unavailable", displayPage: "" };
  const kind = String(currentTab.kind || "unavailable");
  pageCard.dataset.kind = kind;
  pageDisplay.textContent = String(currentTab.displayPage || "");
  pageDisplay.hidden = !pageDisplay.textContent;
  approvalPanel.hidden = true;
  revokePanel.hidden = true;
  controlLabelRow.hidden = true;
  consentConfirmed.checked = false;
  captureControlLabels.checked = false;
  clearActionStatus();

  if (kind === "storyvr") {
    pageValue.textContent = "StoryVR controller";
    pageNote.textContent = "StoryVR records its own controls, creates the data file, checkpoints it, and finalizes it.";
    return;
  }

  if (kind === "approvable") {
    pageValue.textContent = "Story page not approved";
    pageNote.textContent = "Approve this exact page in this tab before its content can be observed. StoryVR's Data collection switch is the second required gate.";
    approvalPanel.hidden = currentTab.canApprove === false;
    controlLabelRow.hidden = !Boolean(currentTab.allowControlLabelConsent);
    updateApprovalButton();
    return;
  }

  if (kind === "approved-original") {
    pageValue.textContent = "Approved original story";
    pageNote.textContent = currentTab.captureControlLabels
      ? "This page can be observed while Data collection is on. Visible labels on clicked controls are included."
      : "This page can be observed while Data collection is on. Visible labels on clicked controls are not included.";
    revokePanel.hidden = currentTab.canRevoke === false;
    return;
  }

  if (kind === "pending-original") {
    pageValue.textContent = "Approval in progress";
    pageNote.textContent = "The extension is attaching the page observer. No page interactions are recorded until approval finishes and Data collection is on.";
    setActionStatus("Approving this story page…", "pending");
    revokePanel.hidden = currentTab.canRevoke === false;
    return;
  }

  if (kind === "unsupported") {
    pageValue.textContent = "This page cannot be approved";
    pageNote.textContent = "Only top-level HTTP or HTTPS pages can be approved. Browser, file, extension, and embedded-frame content are not observed.";
    return;
  }

  pageValue.textContent = "Could not inspect this tab";
  pageNote.textContent = "Close and reopen the popup. If the problem continues, reload the extension.";
}

async function approveCurrentPage() {
  if (actionPending || currentTab?.kind !== "approvable" || !Number.isInteger(currentTabId)) return;
  if (!consentConfirmed.checked) {
    setActionStatus("Confirm that this page is part of the consented study.", "error");
    consentConfirmed.focus();
    return;
  }

  setActionPending(true, "Approving this story page…");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "approve-current-tab",
      tabId: currentTabId,
      consentConfirmed: true,
      captureControlLabels: !controlLabelRow.hidden && captureControlLabels.checked,
    });
    if (response?.ok === false || response?.error) {
      throw new Error(responseError(response, "This page could not be approved."));
    }
    await refreshStatus();
    setActionStatus("This story page is approved.", "success");
  } catch (error) {
    setActionStatus(String(error?.message || "This page could not be approved."), "error");
  } finally {
    setActionPending(false);
  }
}

async function revokeCurrentPage() {
  if (actionPending || !currentTab?.canRevoke || !Number.isInteger(currentTabId)) return;
  setActionPending(true, "Removing access from this tab…");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "revoke-current-tab",
      tabId: currentTabId,
    });
    if (response?.ok === false || response?.error) {
      throw new Error(responseError(response, "Access could not be removed."));
    }
    await refreshStatus();
    setActionStatus("Access to this page was removed.", "success");
  } catch (error) {
    setActionStatus(String(error?.message || "Access could not be removed."), "error");
  } finally {
    setActionPending(false);
  }
}

function setActionPending(pending, message = "") {
  actionPending = pending;
  approveButton.disabled = pending || !consentConfirmed.checked;
  revokeButton.disabled = pending;
  approveButton.setAttribute("aria-busy", String(pending));
  revokeButton.setAttribute("aria-busy", String(pending));
  consentConfirmed.disabled = pending;
  captureControlLabels.disabled = pending;
  if (message) setActionStatus(message, "pending");
}

function updateApprovalButton() {
  approveButton.disabled = actionPending || !consentConfirmed.checked;
}

function setActionStatus(message, state) {
  actionStatus.textContent = message;
  actionStatus.dataset.state = state;
  actionStatus.hidden = !message;
}

function clearActionStatus() {
  setActionStatus("", "");
}

function responseError(response, fallback) {
  if (response?.message) return String(response.message);
  const messages = {
    "active-tab-changed": "The active tab changed. Reopen the popup on the story page and try again.",
    "consent-confirmation-required": "Confirm that this page is part of the consented study.",
    "page-authorization-failed": "Chrome could not authorize this page. Reload it and try again.",
    "storyvr-controller-page": "StoryVR controller pages do not need original-page approval.",
    "unsupported-page": "Only top-level HTTP or HTTPS story pages can be approved.",
  };
  return messages[response?.error] || fallback;
}

function showInitializationError(error) {
  setCollectionStatus("error");
  studyName.textContent = "Configuration unavailable";
  statusNote.textContent = String(error?.message || "Reload the extension and try again.");
  renderCurrentTab({ kind: "unavailable", displayPage: "" });
}
