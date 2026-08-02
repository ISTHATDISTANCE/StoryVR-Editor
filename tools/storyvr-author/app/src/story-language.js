const STORY_PROFILES = Object.freeze({
  shark: Object.freeze({
    name: "Shark safety",
    slug: "shark-season-attacks-survival-tips",
    instructions: Object.freeze({
      "source-graph": ({ beatCount }) => `Check ${beatCount} shark story parts and both choice sections.`,
      "spatial-relations": () => "Place the reader and linked shark models in each scene.",
      "environment-enhancement": () => "Check the saved underwater setting around the shark scenes.",
      "attention-guidance": () => "Add a focus marker only when one visible shark should stand out.",
      "dynamic-geometry": () => "Preview the saved shark motion. Add motion only when a scene needs it.",
      "inter-beat-dynamics": () => "Check the shark animation and every route through both choice sections.",
      "interaction-control": () => "Most steps use buttons. The opening scene lets readers grab and resize a white shark.",
      "transition-pacing": () => "Review every story part and both choices. Try the opening shark action once.",
    }),
    dynamicsPlaceholder: "For example: Make the placed sharks swim slowly around the reader.",
  }),
  classroom: Object.freeze({
    name: "Classroom ventilation",
    slug: "reopen-schools-safety-ventilation",
    instructions: Object.freeze({
      "source-graph": ({ beatCount }) => `Check ${beatCount} scenes in order, from closed windows to safer ventilation.`,
      "spatial-relations": () => "Place the reader around the classroom model and keep the view clear.",
      "environment-enhancement": () => "Keep the neutral setting; the classroom model already provides the room.",
      "attention-guidance": () => "Use a focus marker only for a clear window, student, mask, or airflow target.",
      "dynamic-geometry": () => "Preview saved window, mask, label, and airflow movement.",
      "inter-beat-dynamics": () => "Check changes in windows, airflow, labels, and camera timing.",
      "interaction-control": () => "Readers use the next and back buttons through the classroom explanation.",
      "transition-pacing": ({ beatCount }) => `Review all ${beatCount} scenes in order and test next and back once.`,
    }),
    dynamicsPlaceholder: "For example: Show air moving from the windows across the classroom.",
  }),
  transmission: Object.freeze({
    name: "Cough droplets and distance",
    slug: "coronavirus-transmission-cough-6-feet-ar-ul",
    instructions: Object.freeze({
      "source-graph": ({ beatCount }) => `Check ${beatCount} scenes in order, from the cough to the distance lesson.`,
      "spatial-relations": () => "Place the reader around the cough model; the droplet effect stays attached.",
      "environment-enhancement": () => "Keep the neutral setting; the cough model already provides the simulation.",
      "attention-guidance": () => "Use a focus marker only when the visible person should stand out.",
      "dynamic-geometry": () => "No extra object movement is mapped here. Check cough timing in Scene changes.",
      "inter-beat-dynamics": () => "Check cough, droplet reveal, and camera timing between scenes.",
      "interaction-control": () => "Readers use the next and back buttons through the distance explanation.",
      "transition-pacing": ({ beatCount }) => `Review all ${beatCount} scenes, check droplet timing, and test next and back once.`,
    }),
    dynamicsPlaceholder: "No extra object movement is needed for this story.",
  }),
});

const DEFAULT_INSTRUCTIONS = Object.freeze({
  "source-graph": ({ beatCount }) => `Arrange the ${beatCount} story parts in the order readers should see them.`,
  "spatial-relations": () => "Check object size, position, and reader view.",
  "environment-enhancement": () => "Keep the current setting or choose a new one.",
  "attention-guidance": () => "Choose what readers should notice first.",
  "dynamic-geometry": () => "Choose what moves in each scene.",
  "inter-beat-dynamics": () => "Check how one scene changes into the next.",
  "interaction-control": () => "Choose how readers continue or make a choice.",
  "transition-pacing": () => "Read through the full story once, then finish the review.",
});

const COMPONENT_LABELS = Object.freeze({
  "source-graph": "Story order",
  "spatial-relations": "Place objects",
  "asset-topology": "Place objects",
  "environment-enhancement": "Set the scene",
  "attention-guidance": "Guide attention",
  "dynamic-geometry": "Object movement",
  "inter-beat-dynamics": "Scene changes",
  "interaction-control": "Reader actions",
  "transition-pacing": "Review story",
});

const STATUS_LABELS = Object.freeze({
  saved: "Complete",
  draft: "Changes to finish",
  stale: "Review again",
  ready: "Ready",
  blocked: "Waiting",
});

export function storyProfileId(data) {
  const slug = String(data?.project?.story?.slug || data?.project?.slug || "").trim().toLowerCase();
  for (const [id, profile] of Object.entries(STORY_PROFILES)) {
    if (slug === profile.slug) return id;
  }
  return "default";
}

export function storyShortName(data) {
  const profile = STORY_PROFILES[storyProfileId(data)];
  if (profile) return profile.name;
  return String(data?.project?.story?.title || data?.project?.story?.slug || "Current story");
}

export function storyHeaderEyebrow(data) {
  const storyTitle = String(data?.project?.story?.title || data?.project?.story?.slug || "");
  const storyName = storyShortName(data).trim();
  const comparableLabel = (value) => String(value).trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return comparableLabel(storyName) === comparableLabel(storyTitle) ? "" : storyName;
}

export function participantComponentLabel(componentId, fallback = "") {
  return COMPONENT_LABELS[componentId] || String(fallback || componentId || "Story step");
}

export function participantStatusLabel(status) {
  return STATUS_LABELS[status] || String(status || "");
}

export function storyStageInstruction(data, componentId) {
  const profile = STORY_PROFILES[storyProfileId(data)];
  const instruction = profile?.instructions?.[componentId] || DEFAULT_INSTRUCTIONS[componentId];
  if (!instruction) return "Review this step, make any needed changes, and save it.";
  return instruction({
    beatCount: Math.max(0, data?.graph?.beats?.length || 0),
  });
}

export function storyDynamicsPlaceholder(data) {
  return STORY_PROFILES[storyProfileId(data)]?.dynamicsPlaceholder
    || "For example: Move the main object slowly so readers can follow it.";
}
