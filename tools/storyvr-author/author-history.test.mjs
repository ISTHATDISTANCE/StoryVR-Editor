import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthorHistory,
  historyShortcutForEvent,
  isEditableHistoryTarget,
} from "./app/src/author-history.js";

function state(value, checkpoint = "checkpoint-a") {
  return {
    checkpoint: { id: checkpoint, signature: checkpoint },
    ui: { value },
  };
}

test("history records chronological changes, supports undo/redo, and clears redo after a new change", async () => {
  const history = new AuthorHistory();
  history.record({ label: "First", before: state(0), after: state(1) });
  history.record({ label: "Second", before: state(1), after: state(2) });
  assert.equal(history.undoLabel, "Second");

  const applied = [];
  await history.undo(async (target, entry, direction) => applied.push({ target, entry: entry.label, direction }));
  assert.equal(applied[0].target.ui.value, 1);
  assert.equal(history.redoLabel, "Second");
  await history.redo(async (target, entry, direction) => applied.push({ target, entry: entry.label, direction }));
  assert.equal(applied[1].target.ui.value, 2);

  await history.undo(async () => {});
  history.record({ label: "Replacement", before: state(1), after: state(3) });
  assert.equal(history.canRedo, false);
  assert.equal(history.undoLabel, "Replacement");
});

test("history coalesces a begun transaction, suppresses no-ops, and caps the past stack", () => {
  const history = new AuthorHistory({ limit: 3 });
  assert.equal(history.begin("Typing", "source-graph", state("")), true);
  history.commit(state("finished"));
  assert.equal(history.past.length, 1);
  assert.equal(history.past[0].before.ui.value, "");
  assert.equal(history.past[0].after.ui.value, "finished");

  history.record({ label: "No op", before: state(1), after: state(1) });
  assert.equal(history.past.length, 1);
  for (let index = 0; index < 5; index += 1) {
    history.record({ label: `Change ${index}`, before: state(index), after: state(index + 1) });
  }
  assert.equal(history.past.length, 3);
  assert.deepEqual(history.past.map((entry) => entry.label), ["Change 2", "Change 3", "Change 4"]);
});

test("a failed undo keeps the entry available", async () => {
  const history = new AuthorHistory();
  history.record({ label: "Change", before: state(0), after: state(1) });
  await assert.rejects(history.undo(async () => {
    throw new Error("restore failed");
  }), /restore failed/);
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);
});

test("common shortcuts map correctly outside editable controls", () => {
  const target = { closest: () => null, tagName: "DIV", isContentEditable: false };
  const event = (overrides) => ({
    key: "z",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target,
    ...overrides,
  });
  assert.equal(historyShortcutForEvent(event({ metaKey: true })), "undo");
  assert.equal(historyShortcutForEvent(event({ metaKey: true, shiftKey: true })), "redo");
  assert.equal(historyShortcutForEvent(event({ ctrlKey: true })), "undo");
  assert.equal(historyShortcutForEvent(event({ ctrlKey: true, shiftKey: true })), "redo");
  assert.equal(historyShortcutForEvent(event({ key: "y", ctrlKey: true })), "redo");
  assert.equal(historyShortcutForEvent(event({ key: "y", metaKey: true })), null);
  assert.equal(historyShortcutForEvent(event({ ctrlKey: true, altKey: true })), null);
});

test("native text controls and contenteditable elements retain browser undo", () => {
  const editable = { closest: () => ({ tagName: "TEXTAREA" }), tagName: "TEXTAREA" };
  const contenteditable = { closest: () => ({ isContentEditable: true }), isContentEditable: true };
  assert.equal(isEditableHistoryTarget(editable), true);
  assert.equal(isEditableHistoryTarget(contenteditable), true);
  assert.equal(historyShortcutForEvent({
    key: "z",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target: editable,
  }), null);
});
