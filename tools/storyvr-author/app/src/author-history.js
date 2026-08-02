export const STORYVR_HISTORY_LIMIT = 50;

export class AuthorHistory {
  constructor({ limit = STORYVR_HISTORY_LIMIT, onChange = null } = {}) {
    this.limit = Math.max(1, Number(limit) || STORYVR_HISTORY_LIMIT);
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.past = [];
    this.future = [];
    this.active = null;
    this.busy = false;
    this.sequence = 0;
  }

  begin(label, componentId, before) {
    if (this.busy || this.active) return false;
    this.active = {
      label: normalizeLabel(label),
      componentId: String(componentId || ""),
      before: cloneValue(before),
    };
    return true;
  }

  commit(after) {
    if (!this.active) return null;
    const active = this.active;
    this.active = null;
    return this.recordCloned({ ...active, after: cloneValue(after) });
  }

  cancel() {
    this.active = null;
  }

  record({ label, componentId = "", before, after }) {
    return this.recordCloned({
      label,
      componentId,
      before: cloneValue(before),
      after: cloneValue(after),
    });
  }

  recordCloned({ label, componentId = "", before, after }) {
    if (equivalentHistoryState(before, after)) return null;
    const entry = {
      id: ++this.sequence,
      label: normalizeLabel(label),
      componentId: String(componentId || ""),
      before,
      after,
    };
    this.past.push(entry);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    this.future = [];
    this.notify();
    return entry;
  }

  async undo(apply) {
    if (this.busy || this.active || !this.past.length) return null;
    const entry = this.past.pop();
    this.busy = true;
    this.notify();
    try {
      await apply(cloneValue(entry.before), entry, "undo");
      this.future.push(entry);
      return entry;
    } catch (error) {
      this.past.push(entry);
      throw error;
    } finally {
      this.busy = false;
      this.notify();
    }
  }

  async redo(apply) {
    if (this.busy || this.active || !this.future.length) return null;
    const entry = this.future.pop();
    this.busy = true;
    this.notify();
    try {
      await apply(cloneValue(entry.after), entry, "redo");
      this.past.push(entry);
      return entry;
    } catch (error) {
      this.future.push(entry);
      throw error;
    } finally {
      this.busy = false;
      this.notify();
    }
  }

  clear() {
    this.past = [];
    this.future = [];
    this.active = null;
    this.notify();
  }

  get canUndo() {
    return !this.busy && !this.active && this.past.length > 0;
  }

  get canRedo() {
    return !this.busy && !this.active && this.future.length > 0;
  }

  get undoLabel() {
    return this.past.at(-1)?.label || "";
  }

  get redoLabel() {
    return this.future.at(-1)?.label || "";
  }

  notify() {
    this.onChange?.(this);
  }
}

export function historyShortcutForEvent(event) {
  if (!event || event.defaultPrevented || event.altKey || isEditableHistoryTarget(event.target)) return null;
  const key = String(event.key || "").toLowerCase();
  const primary = Boolean(event.metaKey || event.ctrlKey);
  if (!primary) return null;
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.metaKey) return "redo";
  return null;
}

export function isEditableHistoryTarget(target) {
  if (!target || typeof target !== "object") return false;
  const element = typeof target.closest === "function"
    ? target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")
    : null;
  if (element) return true;
  const tagName = String(target.tagName || "").toLowerCase();
  return ["input", "textarea", "select"].includes(tagName) || target.isContentEditable === true;
}

function equivalentHistoryState(left, right, seen = new WeakMap()) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;

  const seenRight = seen.get(left);
  if (seenRight) return seenRight === right;
  seen.set(left, right);

  if (Array.isArray(left)) {
    if (left.length !== right.length) return false;
    return left.every((value, index) => equivalentHistoryState(value, right[index], seen));
  }
  if (left instanceof Date) return left.getTime() === right.getTime();
  if (left instanceof Set) {
    if (left.size !== right.size) return false;
    const leftValues = [...left];
    const rightValues = [...right];
    return leftValues.every((value, index) => equivalentHistoryState(value, rightValues[index], seen));
  }
  if (left instanceof Map) {
    if (left.size !== right.size) return false;
    const leftEntries = [...left.entries()];
    const rightEntries = [...right.entries()];
    return leftEntries.every(([key, value], index) => (
      equivalentHistoryState(key, rightEntries[index][0], seen)
      && equivalentHistoryState(value, rightEntries[index][1], seen)
    ));
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!equivalentHistoryState(left[key], right[key], seen)) return false;
  }
  return true;
}

function normalizeLabel(value) {
  const label = String(value || "Authoring change").trim();
  return label || "Authoring change";
}

function cloneValue(value) {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
