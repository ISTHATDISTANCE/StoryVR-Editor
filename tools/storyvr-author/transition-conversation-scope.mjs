import {
  normalizeProceduralTransitionMiddle,
  normalizeProceduralTransitionSubjectEntityIds,
} from "./procedural-transitions-runtime.js";

// The edit selection scopes changes, while persisted subjectEntityIds describes
// coverage of the complete plan, including effects retained from earlier turns.
export function normalizeTransitionConversationScope({
  previousPlan = null,
  planSource = null,
  subjectEntityIds = [],
} = {}) {
  const selection = normalizeProceduralTransitionSubjectEntityIds(subjectEntityIds);
  const actions = middleActions(planSource);
  assertActionScope(middleActions(previousPlan), actions, selection);
  const fullPlanSubjects = [];
  for (const action of actions) {
    const entityId = destinationTarget(action);
    // Legacy broad or source effects may survive an edit. Such a full plan does
    // not satisfy the runtime's strictly destination-scoped coverage contract.
    if (!entityId) return [];
    fullPlanSubjects.push(entityId);
  }
  return normalizeProceduralTransitionSubjectEntityIds(fullPlanSubjects).sort();
}

export function assertTransitionConversationSubjectScope({
  previousPlan = null,
  planSource = null,
  subjectEntityIds = [],
} = {}) {
  assertActionScope(
    middleActions(previousPlan),
    middleActions(planSource),
    normalizeProceduralTransitionSubjectEntityIds(subjectEntityIds),
  );
}

function middleActions(plan) {
  return normalizeProceduralTransitionMiddle(
    plan?.middle || plan?.middleSequence || plan?.transientMiddle,
  ).actions;
}

function destinationTarget(action) {
  const target = action?.target;
  return target && !Array.isArray(target)
    && String(target.scope || "").trim().toLowerCase() === "to"
    && typeof target.entityId === "string" && target.entityId
    ? target.entityId
    : null;
}

function assertActionScope(previousActions, nextActions, selection) {
  if (!selection.length) return;
  const selected = new Set(selection);
  const unaffectedActions = (actions) => actions.filter((action) => !selected.has(destinationTarget(action)));
  // Compare all retained records, including duplicate IDs, in their original
  // relative order. An ID-keyed map could silently hide an out-of-scope edit.
  if (signature(unaffectedActions(previousActions)) !== signature(unaffectedActions(nextActions))) {
    throw Object.assign(new Error(
      "A conversational transition edit may change only selected destination objects; preserve every unselected or broad existing middle action unchanged.",
    ), { statusCode: 422, code: "transition-subject-scope-violated" });
  }
}

function signature(value) {
  const canonical = (item) => {
    if (Array.isArray(item)) return item.map(canonical);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])]));
  };
  return JSON.stringify(canonical(value));
}
