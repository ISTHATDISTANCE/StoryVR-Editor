export const ORIGINAL_APPROVAL_SCHEMA_VERSION = "storyvr-original-tab-approvals/v1";
export const ORIGINAL_APPROVAL_STORAGE_KEY = "storyvrOriginalTabApprovals";
export const MAX_APPROVED_ORIGINAL_TABS = 32;

const MAX_TOKEN_LENGTH = 160;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const APPROVAL_STATUSES = new Set(["pending", "approved"]);

export function canonicalOriginalPage(urlValue) {
  let url;
  try {
    url = new URL(String(urlValue || ""));
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  const pathname = url.pathname || "/";
  return {
    origin: url.origin,
    pathname,
    canonical: `${url.origin}${pathname}`,
  };
}

export async function fingerprintOriginalPage(urlValue, cryptoRef = globalThis.crypto) {
  const page = canonicalOriginalPage(urlValue);
  if (!page || !cryptoRef?.subtle?.digest) return "";
  const digest = await cryptoRef.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(page.canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeApprovalRegistry(value) {
  const result = {
    schemaVersion: ORIGINAL_APPROVAL_SCHEMA_VERSION,
    approvalsByTabId: {},
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  if (value.schemaVersion !== ORIGINAL_APPROVAL_SCHEMA_VERSION) return result;
  for (const [tabId, approvalValue] of Object.entries(value.approvalsByTabId || {}).slice(0, MAX_APPROVED_ORIGINAL_TABS)) {
    if (!Number.isInteger(Number(tabId))) continue;
    const approval = normalizedApproval(approvalValue);
    if (approval) result.approvalsByTabId[tabId] = approval;
  }
  return result;
}

export function createPendingOriginalApproval(registryValue, {
  tabId,
  scopeFingerprint,
  pageKey,
  grantToken,
  approvedAt,
  captureScrollDepth = true,
  captureControlLabels = false,
} = {}) {
  const registry = normalizeApprovalRegistry(registryValue);
  if (!Number.isInteger(tabId)) throw new TypeError("A valid tab is required for original-page approval.");
  if (!SHA256_HEX_PATTERN.test(String(scopeFingerprint || ""))) {
    throw new TypeError("A valid page fingerprint is required for original-page approval.");
  }
  const safePageKey = safeToken(pageKey, MAX_TOKEN_LENGTH);
  const safeGrantToken = safeToken(grantToken, MAX_TOKEN_LENGTH);
  if (!safePageKey || !safeGrantToken) throw new TypeError("A page key and grant token are required.");
  const key = String(tabId);
  if (!(key in registry.approvalsByTabId)
    && Object.keys(registry.approvalsByTabId).length >= MAX_APPROVED_ORIGINAL_TABS) {
    throw new RangeError("Too many original-story tabs are already approved.");
  }
  registry.approvalsByTabId[key] = {
    status: "pending",
    scopeFingerprint: String(scopeFingerprint),
    pageKey: safePageKey,
    grantToken: safeGrantToken,
    documentId: "",
    approvedAt: validIsoDate(approvedAt),
    captureScrollDepth: Boolean(captureScrollDepth),
    captureControlLabels: Boolean(captureControlLabels),
  };
  return registry;
}

export function finalizeOriginalApproval(registryValue, {
  tabId,
  scopeFingerprint,
  grantToken,
  documentId,
} = {}) {
  const registry = normalizeApprovalRegistry(registryValue);
  const approval = approvalForTab(registry, tabId);
  const safeDocumentId = safeToken(documentId, MAX_TOKEN_LENGTH);
  if (!approval
    || approval.scopeFingerprint !== String(scopeFingerprint || "")
    || approval.grantToken !== safeToken(grantToken, MAX_TOKEN_LENGTH)
    || !safeDocumentId) {
    return registry;
  }
  registry.approvalsByTabId[String(tabId)] = {
    ...approval,
    status: "approved",
    documentId: safeDocumentId,
  };
  return registry;
}

export function suspendOriginalApproval(registryValue, tabId) {
  const registry = normalizeApprovalRegistry(registryValue);
  const approval = approvalForTab(registry, tabId);
  if (!approval) return registry;
  registry.approvalsByTabId[String(tabId)] = {
    ...approval,
    status: "pending",
    documentId: "",
  };
  return registry;
}

export function revokeOriginalApproval(registryValue, tabId) {
  const registry = normalizeApprovalRegistry(registryValue);
  if (Number.isInteger(tabId)) delete registry.approvalsByTabId[String(tabId)];
  return registry;
}

export function approvalForTab(registryValue, tabId) {
  if (!Number.isInteger(tabId)) return null;
  const registry = normalizeApprovalRegistry(registryValue);
  const approval = registry.approvalsByTabId[String(tabId)];
  return approval ? { ...approval } : null;
}

export function approvedOriginalEntries(registryValue) {
  const registry = normalizeApprovalRegistry(registryValue);
  return Object.entries(registry.approvalsByTabId).map(([tabId, approval]) => ({
    tabId: Number(tabId),
    approval: { ...approval },
  }));
}

export function authorizedOriginalContext(registryValue, sender, {
  scopeFingerprint,
  grantToken,
} = {}) {
  if (!sender
    || sender.frameId !== 0
    || !sender.tab
    || !Number.isInteger(sender.tab.id)
    || !sender.documentId) {
    return null;
  }
  const approval = approvalForTab(registryValue, sender.tab.id);
  if (!approval
    || approval.status !== "approved"
    || approval.scopeFingerprint !== String(scopeFingerprint || "")
    || approval.grantToken !== safeToken(grantToken, MAX_TOKEN_LENGTH)
    || approval.documentId !== safeToken(sender.documentId, MAX_TOKEN_LENGTH)) {
    return null;
  }
  return publicOriginalContext(approval);
}

export function publicOriginalContext(approvalValue) {
  const approval = normalizedApproval(approvalValue);
  if (!approval) return null;
  return {
    surface: "original",
    pageKey: approval.pageKey,
    captureScrollDepth: approval.captureScrollDepth,
    captureControlLabels: approval.captureControlLabels,
    semanticTargets: [],
  };
}

function normalizedApproval(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = safeToken(value.status, 40);
  const scopeFingerprint = String(value.scopeFingerprint || "").toLowerCase();
  const pageKey = safeToken(value.pageKey, MAX_TOKEN_LENGTH);
  const grantToken = safeToken(value.grantToken, MAX_TOKEN_LENGTH);
  const documentId = safeToken(value.documentId, MAX_TOKEN_LENGTH);
  if (!APPROVAL_STATUSES.has(status)
    || !SHA256_HEX_PATTERN.test(scopeFingerprint)
    || !pageKey
    || !grantToken
    || (status === "approved" && !documentId)) {
    return null;
  }
  return {
    status,
    scopeFingerprint,
    pageKey,
    grantToken,
    documentId: status === "approved" ? documentId : "",
    approvedAt: validIsoDate(value.approvedAt),
    captureScrollDepth: Boolean(value.captureScrollDepth),
    captureControlLabels: Boolean(value.captureControlLabels),
  };
}

function safeToken(value, maximumLength) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_.:-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maximumLength);
}

function validIsoDate(value) {
  const date = new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}
