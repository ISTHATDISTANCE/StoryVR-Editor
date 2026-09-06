import { createHash, randomUUID } from "node:crypto";

export const ENVIRONMENT_CONVERSATION_SCHEMA_VERSION = "storyvr-environment-conversation/v1";

function text(value, maximum = 4000) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maximum) : "";
}

function clone(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

export function environmentStoreForReader(value) {
  const { conversationsByScene: _conversations, ...runtime } = value || {};
  return runtime;
}

export function environmentConversationSceneKey({ beatId, variantOptionId = null } = {}) {
  const beat = text(beatId, Infinity);
  if (!beat) return null;
  const variant = text(variantOptionId, Infinity);
  return variant ? `beat:${beat}:variant:${variant}` : beat;
}

export function normalizeEnvironmentConversation(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    schemaVersion: ENVIRONMENT_CONVERSATION_SCHEMA_VERSION,
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    updatedAt: text(source.updatedAt, 80) || null,
    messages: (Array.isArray(source.messages) ? source.messages : []).flatMap((message) => {
      if (!["user", "assistant"].includes(message?.role)) return [];
      const content = text(message.content, message.role === "user" ? 1000 : 4000);
      if (!content) return [];
      return [{
        id: text(message.id, 160),
        role: message.role,
        content,
        createdAt: text(message.createdAt, 80) || null,
        ...(message.role === "assistant" && Object.hasOwn(message, "assignment") ? {
          assignment: clone(message.assignment),
          outcome: ["clarification", "unchanged"].includes(message.outcome) ? message.outcome : "accepted",
        } : {}),
      }];
    }),
  };
}

export function normalizeEnvironmentConversations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key.trim() && !/[\u0000-\u001f\u007f]/.test(key))
    .map(([key, conversation]) => [key, normalizeEnvironmentConversation(conversation)]));
}

export function environmentConversationForScene(store, sceneContext) {
  const key = environmentConversationSceneKey(sceneContext);
  if (key && Object.hasOwn(store?.conversationsByScene || {}, key)) {
    return normalizeEnvironmentConversation(store.conversationsByScene[key]);
  }
  const conversation = normalizeEnvironmentConversation(null);
  if (!key) return conversation;
  const { beatId, variantOptionId } = sceneContext;
  const assignment = variantOptionId && Object.hasOwn(store?.assignmentsByScene || {}, key)
    ? store.assignmentsByScene[key]
    : Object.hasOwn(store?.assignmentsByBeat || {}, beatId)
      ? store.assignmentsByBeat[beatId]
      : store?.defaultAssignment;
  if (!assignment?.asset) return conversation;
  conversation.messages = [
    {
      id: "legacy-user", role: "user", createdAt: null,
      content: text(assignment.provenance?.prompt, 1000)
        || text(assignment.description, 1000)
        || "Use the background already saved in this scene.",
    },
    {
      id: "legacy-assistant", role: "assistant", createdAt: null,
      content: "This is the previously saved background. Further messages can refine it.",
      assignment: clone(assignment), outcome: "accepted",
    },
  ];
  return conversation;
}

export function environmentConversationSignature(conversation) {
  return createHash("sha256").update(JSON.stringify(normalizeEnvironmentConversation(conversation))).digest("hex");
}

export function createEnvironmentConversationTurn(conversation, message, reply, {
  needsClarification = false, unchanged = false,
} = {}) {
  return {
    id: randomUUID(),
    message: text(message, 1000),
    reply: text(reply) || "Updated the background and matching ground using your message and the saved setting.",
    baselineSignature: environmentConversationSignature(conversation),
    ...(needsClarification ? { needsClarification: true } : {}),
    ...(unchanged ? { unchanged: true } : {}),
  };
}

export function validateEnvironmentConversationTurn(value, conversation, prompt) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !text(value.id, 160) || !text(value.message, 1000) || !text(value.reply)
    || text(value.message, 1000) !== text(prompt, 1000)) {
    throw Object.assign(new Error("The background conversation result is invalid. Send the message again."), { statusCode: 400 });
  }
  if (value.baselineSignature !== environmentConversationSignature(conversation)) {
    throw Object.assign(new Error("This scene's background conversation changed while the reply was being generated. Send the message again."), { statusCode: 409 });
  }
  return {
    id: text(value.id, 160), message: text(value.message, 1000), reply: text(value.reply),
    baselineSignature: value.baselineSignature,
    ...(value.needsClarification === true ? { needsClarification: true } : {}),
    ...(value.unchanged === true ? { unchanged: true } : {}),
  };
}

export function appendEnvironmentConversationTurn(conversation, turn, assignment, now = new Date().toISOString()) {
  const current = normalizeEnvironmentConversation(conversation);
  return {
    ...current,
    revision: current.revision + 1,
    updatedAt: now,
    messages: [
      ...current.messages,
      { id: `${turn.id}:user`, role: "user", content: turn.message, createdAt: now },
      {
        id: `${turn.id}:assistant`, role: "assistant", content: turn.reply, createdAt: now,
        assignment: clone(assignment),
        outcome: turn.needsClarification ? "clarification" : turn.unchanged ? "unchanged" : "accepted",
      },
    ],
  };
}
