import {
  ORIGINAL_APPROVAL_STORAGE_KEY,
  approvalForTab,
  approvedOriginalEntries,
  authorizedOriginalContext,
  canonicalOriginalPage,
  createPendingOriginalApproval,
  finalizeOriginalApproval,
  fingerprintOriginalPage,
  normalizeApprovalRegistry,
  publicOriginalContext,
  revokeOriginalApproval,
  suspendOriginalApproval,
} from "./approval-model.js";
import {
  STUDY_SESSION_STORAGE_KEY,
  matchConfiguredPage,
  reduceStudySession,
  senderStudyPage,
} from "./session-model.js";

const CONFIG_FILE = "study-config.json";
const CONTROLLER_MESSAGE = "storyvr-controller";
const OBSERVER_EVENT_MESSAGE = "study-observer-event";
const CONTROLLER_EVENT_MESSAGE = "study-controller-event";
const PRESENCE_MESSAGE = "study-page-presence";
const POPUP_STATUS_MESSAGE = "popup-status";
const APPROVE_TAB_MESSAGE = "approve-current-tab";
const REVOKE_TAB_MESSAGE = "revoke-current-tab";

let configPromise;
let mutationQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({
      ok: false,
      error: String(error?.message || "The StoryVR study extension could not process this request."),
    }));
  return true;
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  return queueCapturedAction({ type: "tab-activated", tabId }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  queueMutation(() => revokeTabInternal(tabId, { notify: false })).catch(() => {});
});

chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
  queueMutation(() => revokeTabInternal(removedTabId, { notify: false })).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !["loading", "complete"].includes(changeInfo.status)) return;
  queueMutation(() => handleTabUpdate(tabId, changeInfo, tab)).catch(() => {});
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  return queueCapturedAction({
    type: "browser-focus-change",
    focused: windowId !== chrome.windows.WINDOW_ID_NONE,
  }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  refreshBadge().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  refreshBadge().catch(() => {});
});

async function handleMessage(message, sender) {
  const config = await loadConfig();
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { ok: false, error: "invalid-message" };
  }

  if (message.type === POPUP_STATUS_MESSAGE && isExtensionPageSender(sender)) {
    const result = await queueAction({ type: "status" });
    return {
      ok: true,
      ...result.response,
      displayName: config.displayName,
      studyConfigId: config.studyConfigId,
      approvalMode: "explicit-current-tab",
      currentTab: Number.isInteger(message.tabId)
        ? await currentTabStatus(config, message.tabId)
        : null,
    };
  }

  if (message.type === APPROVE_TAB_MESSAGE && isExtensionPageSender(sender)) {
    if (message.consentConfirmed !== true) {
      return { ok: false, error: "consent-confirmation-required" };
    }
    return approveCurrentTab(config, message);
  }

  if (message.type === REVOKE_TAB_MESSAGE && isExtensionPageSender(sender)) {
    return revokeCurrentTab(message);
  }

  if (sender.id !== chrome.runtime.id) return { ok: false, error: "untrusted-sender" };

  if (message.type === PRESENCE_MESSAGE) {
    const surface = message.surface === "storyvr" ? "storyvr" : "original";
    const context = surface === "storyvr"
      ? senderStudyPage(config, sender, "storyvr")
      : await authorizedContextForMessage(sender, message);
    if (!context) return { ok: false, active: false, error: "page-not-approved" };
    const result = await queueAction({
      type: "register-tab",
      tabId: sender.tab.id,
      context,
    });
    return {
      ok: true,
      ...result.response,
      page: publicPageConfig(context),
    };
  }

  if (message.type === CONTROLLER_MESSAGE) {
    const context = senderStudyPage(config, sender, "storyvr");
    if (!context) return { connected: false, error: "controller-page-not-approved" };
    return handleControllerCommand(message.command, message.payload, sender.tab.id, context);
  }

  if (message.type === OBSERVER_EVENT_MESSAGE || message.type === CONTROLLER_EVENT_MESSAGE) {
    const context = message.type === CONTROLLER_EVENT_MESSAGE
      ? senderStudyPage(config, sender, "storyvr")
      : await authorizedContextForMessage(sender, message);
    if (!context) return { recorded: false, error: "page-not-approved" };
    const result = await queueCapturedAction({
      type: "record",
      tabId: sender.tab.id,
      context,
      event: message.event,
    });
    return result.response;
  }

  return { ok: false, error: "unsupported-message" };
}

async function handleControllerCommand(command, payload, tabId, context) {
  const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  if (command === "start-session") {
    const result = await queueAction({
      type: "start",
      sessionId: value.sessionId,
      startedAt: value.startedAt,
      tabId,
      pageKey: context.pageKey,
    });
    if (result.response.started && result.response.status === "collecting") {
      await seedApprovedTabsIntoSession();
      await broadcastToStudyTabs({ type: "study-session-started" });
    }
    return result.response;
  }

  if (command === "request-stop") {
    const result = await queueAction({
      type: "request-stop",
      sessionId: value.sessionId,
      stoppedAt: value.stoppedAt,
    });
    if (result.response.stopped && !result.response.alreadyStopped) {
      await broadcastToStudyTabs({ type: "study-session-paused", reason: "stop-requested" });
    }
    return result.response;
  }

  if (command === "cancel-session") {
    const approvalRegistry = await readApprovalRegistry();
    const originalTabIds = approvedOriginalEntries(approvalRegistry).map(({ tabId: approvedTabId }) => approvedTabId);
    const result = await queueAction({
      type: "cancel",
      sessionId: value.sessionId,
    });
    if (result.response.canceled && !result.response.alreadyCanceled) {
      await broadcastToTabIds([tabId, ...originalTabIds], { type: "study-session-stopped" });
      await queueMutation(() => revokeAllOriginalApprovals({ notify: true }));
    }
    return result.response;
  }

  if (command === "prepare-export") {
    const result = await queueAction({
      type: "prepare-export",
      sessionId: value.sessionId,
      endedAt: value.endedAt,
    });
    if (result.response.prepared) {
      await broadcastToStudyTabs({ type: "study-session-paused", reason: "saving" });
    }
    return { ...result.response, approvalMode: "explicit-current-tab" };
  }

  if (command === "prepare-checkpoint") {
    const result = await queueAction({
      type: "prepare-checkpoint",
      sessionId: value.sessionId,
      checkpointedAt: value.checkpointedAt,
    });
    return { ...result.response, approvalMode: "explicit-current-tab" };
  }

  if (command === "abort-checkpoint") {
    const result = await queueAction({
      type: "abort-checkpoint",
      sessionId: value.sessionId,
      checkpointToken: value.checkpointToken,
    });
    return result.response;
  }

  if (command === "commit-checkpoint") {
    const result = await queueAction({
      type: "commit-checkpoint",
      sessionId: value.sessionId,
      checkpointToken: value.checkpointToken,
    });
    if (result.response.committed && result.response.checkpointNeeded) {
      await broadcastToControllerTabs({
        type: "study-checkpoint-needed",
        reason: "buffer-remains",
      });
    }
    if (result.response.committed && result.response.resumedFromLimit) {
      await broadcastToStudyTabs({ type: "study-session-started" });
    }
    return result.response;
  }

  if (command === "abort-export") {
    const result = await queueAction({
      type: "abort-export",
      sessionId: value.sessionId,
      exportToken: value.exportToken,
    });
    if (result.response.aborted
      && !result.response.alreadyAborted
      && result.response.status === "collecting") {
      await broadcastToStudyTabs({ type: "study-session-started" });
    }
    return result.response;
  }

  if (command === "commit-export") {
    const approvalRegistry = await readApprovalRegistry();
    const originalTabIds = approvedOriginalEntries(approvalRegistry).map(({ tabId: approvedTabId }) => approvedTabId);
    const result = await queueAction({
      type: "commit-export",
      sessionId: value.sessionId,
      exportToken: value.exportToken,
    });
    if (result.response.committed && !result.response.alreadyCommitted) {
      await broadcastToTabIds([tabId, ...originalTabIds], { type: "study-session-stopped" });
      await queueMutation(() => revokeAllOriginalApprovals({ notify: true }));
    }
    return result.response;
  }

  return { connected: true, error: "unsupported-command" };
}

async function approveCurrentTab(config, message) {
  const tab = await activeTabForRequest(message.tabId);
  if (!tab || !Number.isInteger(tab.id)) return { ok: false, error: "active-tab-changed" };
  if (matchConfiguredPage(config, tab.url, "storyvr")) {
    return { ok: false, error: "storyvr-controller-page" };
  }
  const page = canonicalOriginalPage(tab.url);
  const scopeFingerprint = await fingerprintOriginalPage(tab.url);
  if (!page || !scopeFingerprint) return { ok: false, error: "unsupported-page" };

  const grantToken = `grant-${randomToken()}`;
  const pageKey = `original-${randomToken().replace(/-/g, "").slice(0, 20)}`;
  const captureControlLabels = Boolean(
    config.originalPageConsent?.allowControlLabelConsent
    && message.captureControlLabels === true,
  );

  return queueMutation(async () => {
    const stillActive = await activeTabForRequest(tab.id);
    const stillActiveFingerprint = await fingerprintOriginalPage(stillActive?.url);
    if (!stillActive || stillActiveFingerprint !== scopeFingerprint) {
      return { ok: false, error: "active-tab-changed" };
    }
    let registry = await readApprovalRegistry();
    registry = createPendingOriginalApproval(registry, {
      tabId: tab.id,
      scopeFingerprint,
      pageKey,
      grantToken,
      approvedAt: new Date().toISOString(),
      captureScrollDepth: Boolean(config.originalPageConsent?.captureScrollDepth),
      captureControlLabels,
    });
    await writeApprovalRegistry(registry);
    await applyAction({ type: "remove-tab", tabId: tab.id });

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        files: ["original-observer.js"],
        world: "ISOLATED",
        injectImmediately: true,
      });
      const mainFrame = Array.isArray(results) ? results.find(({ frameId }) => frameId === 0) : null;
      if (!mainFrame?.documentId) throw new Error("missing-document-identity");
      registry = finalizeOriginalApproval(registry, {
        tabId: tab.id,
        scopeFingerprint,
        grantToken,
        documentId: mainFrame.documentId,
      });
      const approval = approvalForTab(registry, tab.id);
      if (!approval || approval.status !== "approved") throw new Error("approval-finalization-failed");
      await writeApprovalRegistry(registry);
      await applyAction({
        type: "register-tab",
        tabId: tab.id,
        context: publicOriginalContext(approval),
      });
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "study-consent-granted",
        grantToken,
      });
      if (!response?.accepted) throw new Error("observer-handshake-failed");
      return {
        ok: true,
        approved: true,
        page: {
          kind: "approved-original",
          approved: true,
          canApprove: false,
          canRevoke: true,
          displayPage: page.canonical,
          captureControlLabels,
        },
      };
    } catch {
      await revokeTabInternal(tab.id, { notify: true });
      return {
        ok: false,
        error: "page-authorization-failed",
        message: "Chrome could not authorize this page. Reload it and try again.",
      };
    }
  });
}

async function revokeCurrentTab(message) {
  const tab = await activeTabForRequest(message.tabId);
  if (!tab || !Number.isInteger(tab.id)) return { ok: false, error: "active-tab-changed" };
  const revoked = await queueMutation(() => revokeTabInternal(tab.id, { notify: true }));
  return { ok: true, revoked };
}

async function currentTabStatus(config, requestedTabId) {
  const tab = await activeTabForRequest(requestedTabId).catch(() => null);
  if (!tab) return { kind: "unavailable", approved: false, canApprove: false, canRevoke: false };
  if (matchConfiguredPage(config, tab.url, "storyvr")) {
    return { kind: "storyvr", approved: true, canApprove: false, canRevoke: false };
  }
  const page = canonicalOriginalPage(tab.url);
  const scopeFingerprint = await fingerprintOriginalPage(tab.url);
  if (!page || !scopeFingerprint) {
    return { kind: "unsupported", approved: false, canApprove: false, canRevoke: false };
  }
  const registry = await readApprovalRegistry();
  const approval = approvalForTab(registry, tab.id);
  const matches = approval?.scopeFingerprint === scopeFingerprint;
  if (matches && approval.status === "approved") {
    return {
      kind: "approved-original",
      approved: true,
      canApprove: false,
      canRevoke: true,
      displayPage: page.canonical,
      captureControlLabels: approval.captureControlLabels,
    };
  }
  if (matches && approval.status === "pending") {
    return {
      kind: "pending-original",
      approved: false,
      canApprove: false,
      canRevoke: true,
      displayPage: page.canonical,
    };
  }
  if (approval && !matches) {
    await queueMutation(() => revokeTabInternal(tab.id, { notify: true }));
  }
  return {
    kind: "approvable",
    approved: false,
    canApprove: true,
    canRevoke: false,
    displayPage: page.canonical,
    allowControlLabelConsent: Boolean(config.originalPageConsent?.allowControlLabelConsent),
  };
}

async function authorizedContextForMessage(sender, message) {
  const scopeFingerprint = await fingerprintOriginalPage(sender.url || sender.tab?.url);
  if (!scopeFingerprint) return null;
  const registry = await readApprovalRegistry();
  const context = authorizedOriginalContext(registry, sender, {
    scopeFingerprint,
    grantToken: message.grantToken,
  });
  return context;
}

async function handleTabUpdate(tabId, changeInfo, tab) {
  const registry = await readApprovalRegistry();
  const approval = approvalForTab(registry, tabId);
  if (!approval) {
    if (changeInfo.status === "loading") await applyAction({ type: "remove-tab", tabId });
    return;
  }

  const tabUrl = changeInfo.url || tab?.url;
  const scopeFingerprint = await fingerprintOriginalPage(tabUrl);
  if (!scopeFingerprint || scopeFingerprint !== approval.scopeFingerprint) {
    await revokeTabInternal(tabId, { notify: true });
    return;
  }

  if (changeInfo.status === "loading") {
    await writeApprovalRegistry(suspendOriginalApproval(registry, tabId));
    await applyAction({ type: "remove-tab", tabId });
    await chrome.tabs.sendMessage(tabId, { type: "study-consent-revoked" }).catch(() => {});
    return;
  }

  if (changeInfo.status === "complete") {
    await restoreApprovedTab(tabId, scopeFingerprint);
  }
}

async function restoreApprovedTab(tabId, scopeFingerprint) {
  let registry = await readApprovalRegistry();
  const approval = approvalForTab(registry, tabId);
  if (!approval || approval.scopeFingerprint !== scopeFingerprint) return false;
  registry = suspendOriginalApproval(registry, tabId);
  await writeApprovalRegistry(registry);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ["original-observer.js"],
      world: "ISOLATED",
      injectImmediately: true,
    });
    const mainFrame = Array.isArray(results) ? results.find(({ frameId }) => frameId === 0) : null;
    if (!mainFrame?.documentId) throw new Error("missing-document-identity");
    registry = finalizeOriginalApproval(registry, {
      tabId,
      scopeFingerprint,
      grantToken: approval.grantToken,
      documentId: mainFrame.documentId,
    });
    const finalized = approvalForTab(registry, tabId);
    if (!finalized || finalized.status !== "approved") throw new Error("approval-finalization-failed");
    await writeApprovalRegistry(registry);
    await applyAction({ type: "register-tab", tabId, context: publicOriginalContext(finalized) });
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "study-consent-granted",
      grantToken: finalized.grantToken,
    });
    if (!response?.accepted) throw new Error("observer-handshake-failed");
    return true;
  } catch {
    await revokeTabInternal(tabId, { notify: true });
    return false;
  }
}

async function seedApprovedTabsIntoSession() {
  const registry = await readApprovalRegistry();
  for (const { tabId, approval } of approvedOriginalEntries(registry)) {
    if (approval.status !== "approved") continue;
    await queueAction({ type: "register-tab", tabId, context: publicOriginalContext(approval) });
  }
}

function queueMutation(operation) {
  const task = mutationQueue.then(operation);
  mutationQueue = task.catch(() => {});
  return task;
}

function queueAction(action) {
  return queueMutation(() => applyAction(action));
}

async function queueCapturedAction(action) {
  const result = await queueAction(action);
  if (result.response.checkpointNeeded) {
    await broadcastToControllerTabs({
      type: "study-checkpoint-needed",
      reason: "buffer-threshold",
    });
  }
  if (result.response.limitReached) {
    await broadcastToStudyTabs({ type: "study-session-paused", reason: "buffer-limit-reached" });
  }
  return result;
}

async function applyAction(action) {
  const config = await loadConfig();
  const stored = await chrome.storage.session.get(STUDY_SESSION_STORAGE_KEY);
  const result = reduceStudySession(stored[STUDY_SESSION_STORAGE_KEY] || null, action, {
    studyConfigId: config.studyConfigId,
  });
  if (result.state) {
    await chrome.storage.session.set({ [STUDY_SESSION_STORAGE_KEY]: result.state });
  } else {
    await chrome.storage.session.remove(STUDY_SESSION_STORAGE_KEY);
  }
  await updateBadge(result.state);
  return result;
}

async function readApprovalRegistry() {
  const stored = await chrome.storage.session.get(ORIGINAL_APPROVAL_STORAGE_KEY);
  return normalizeApprovalRegistry(stored[ORIGINAL_APPROVAL_STORAGE_KEY]);
}

async function writeApprovalRegistry(registryValue) {
  const registry = normalizeApprovalRegistry(registryValue);
  if (approvedOriginalEntries(registry).length) {
    await chrome.storage.session.set({ [ORIGINAL_APPROVAL_STORAGE_KEY]: registry });
  } else {
    await chrome.storage.session.remove(ORIGINAL_APPROVAL_STORAGE_KEY);
  }
}

async function revokeTabInternal(tabId, { notify } = {}) {
  const registry = await readApprovalRegistry();
  const existed = Boolean(approvalForTab(registry, tabId));
  await writeApprovalRegistry(revokeOriginalApproval(registry, tabId));
  await applyAction({ type: "remove-tab", tabId });
  if (notify && existed) {
    await chrome.tabs.sendMessage(tabId, { type: "study-consent-revoked" }).catch(() => {});
  }
  return existed;
}

async function revokeAllOriginalApprovals({ notify } = {}) {
  const registry = await readApprovalRegistry();
  const entries = approvedOriginalEntries(registry);
  await chrome.storage.session.remove(ORIGINAL_APPROVAL_STORAGE_KEY);
  for (const { tabId } of entries) {
    if (notify) await chrome.tabs.sendMessage(tabId, { type: "study-consent-revoked" }).catch(() => {});
  }
}

async function loadConfig() {
  if (!configPromise) {
    configPromise = fetch(chrome.runtime.getURL(CONFIG_FILE), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Study configuration could not be loaded (${response.status}).`);
        return response.json();
      });
  }
  return configPromise;
}

function publicPageConfig(context) {
  return {
    surface: context.surface,
    pageKey: context.pageKey,
    captureScrollDepth: Boolean(context.captureScrollDepth),
    captureControlLabels: Boolean(context.captureControlLabels),
    semanticTargets: [],
  };
}

async function broadcastToStudyTabs(message) {
  const stored = await chrome.storage.session.get(STUDY_SESSION_STORAGE_KEY);
  const sessionTabIds = Object.keys(stored[STUDY_SESSION_STORAGE_KEY]?.tabContexts || {}).map(Number);
  const approvalTabIds = approvedOriginalEntries(await readApprovalRegistry()).map(({ tabId }) => tabId);
  await broadcastToTabIds([...sessionTabIds, ...approvalTabIds], message);
}

async function broadcastToControllerTabs(message) {
  const stored = await chrome.storage.session.get(STUDY_SESSION_STORAGE_KEY);
  const contexts = stored[STUDY_SESSION_STORAGE_KEY]?.tabContexts || {};
  const controllerTabIds = Object.entries(contexts)
    .filter(([, context]) => context?.surface === "storyvr")
    .map(([tabId]) => Number(tabId));
  await broadcastToTabIds(controllerTabIds, message);
}

async function broadcastToTabIds(tabIds, message) {
  const uniqueTabIds = [...new Set(tabIds.filter(Number.isInteger))];
  await Promise.all(uniqueTabIds.map((tabId) => chrome.tabs.sendMessage(tabId, message).catch(() => {})));
}

async function activeTabForRequest(requestedTabId) {
  if (!Number.isInteger(requestedTabId)) return null;
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  return tab?.id === requestedTabId ? tab : null;
}

function isExtensionPageSender(sender) {
  return sender?.id === chrome.runtime.id
    && String(sender.url || "").startsWith(chrome.runtime.getURL(""));
}

function randomToken() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

async function refreshBadge() {
  const stored = await chrome.storage.session.get(STUDY_SESSION_STORAGE_KEY);
  await updateBadge(stored[STUDY_SESSION_STORAGE_KEY] || null);
}

async function updateBadge(state) {
  let text = "";
  let color = "#0b6f69";
  if (state?.status === "collecting") text = "ON";
  if (state?.status === "prepared") {
    text = "SAVE";
    color = "#9a5b00";
  }
  if (state?.status === "checkpoint-prepared") {
    text = "SAVE";
    color = "#9a5b00";
  }
  if (state?.status === "stop-requested") {
    text = "OFF";
    color = "#9a5b00";
  }
  if (state?.status === "limit-reached") {
    text = "!";
    color = "#a73535";
  }
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}
