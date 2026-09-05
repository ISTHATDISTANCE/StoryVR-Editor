import { createHash, randomUUID } from "node:crypto";

export const DYNAMICS_CONVERSATION_SCHEMA_VERSION = "storyvr-dynamics-conversation/v1";

export function dynamicsStoreForReader(value) {
  const { conversationsByScene: _conversation, ...runtime } = value || {};
  return runtime;
}

function text(value, maximum = 4000) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maximum) : "";
}

function clone(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

export function normalizeDynamicsConversation(value) {
  const source = value && typeof value === "object" ? value : {};
  const messages = (Array.isArray(source.messages) ? source.messages : []).flatMap((message) => {
    if (!["user", "assistant"].includes(message?.role)) return [];
    const content = text(message.content, message.role === "user" ? 1000 : 4000);
    if (!content) return [];
    return [{
      id: text(message.id, 160),
      role: message.role,
      content,
      createdAt: text(message.createdAt, 80) || null,
      ...(message.role === "assistant" && Object.hasOwn(message, "plan")
        ? { plan: clone(message.plan), outcome: message.outcome === "clarification" ? "clarification" : "accepted" } : {}),
    }];
  });
  return {
    schemaVersion: DYNAMICS_CONVERSATION_SCHEMA_VERSION,
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    updatedAt: text(source.updatedAt, 80) || null,
    messages,
  };
}

export function normalizeDynamicsConversations(value, contexts = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !contexts || Object.hasOwn(contexts, key))
    .map(([key, conversation]) => [key, normalizeDynamicsConversation(conversation)]));
}

export function dynamicsConversationForScene(store, sceneKey, previousPlan = null) {
  if (Object.hasOwn(store?.conversationsByScene || {}, sceneKey)) {
    return normalizeDynamicsConversation(store.conversationsByScene[sceneKey]);
  }
  const conversation = normalizeDynamicsConversation(null);
  if (!previousPlan) return conversation;
  conversation.messages = [
    {
      id: "legacy-user",
      role: "user",
      content: text(previousPlan.prompt, 1000) || "Use the animation already saved in this scene.",
      createdAt: null,
    },
    {
      id: "legacy-assistant",
      role: "assistant",
      content: "This is the previously saved animation. Further messages can refine it.",
      createdAt: null,
      plan: clone(previousPlan),
      outcome: "accepted",
    },
  ];
  return conversation;
}

export function dynamicsConversationSignature(conversation) {
  return createHash("sha256").update(JSON.stringify(normalizeDynamicsConversation(conversation))).digest("hex");
}

export function createDynamicsConversationTurn(conversation, message, reply, { needsClarification = false } = {}) {
  return {
    id: randomUUID(),
    message: text(message, 1000),
    reply: text(reply) || "Updated the animation using your message and the current scene.",
    baselineSignature: dynamicsConversationSignature(conversation),
    ...(needsClarification ? { needsClarification: true } : {}),
  };
}

export function validateDynamicsConversationTurn(value, conversation, prompt) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !text(value.id, 160) || !text(value.message, 1000) || !text(value.reply)
    || text(value.message, 1000) !== text(prompt, 1000)) {
    throw Object.assign(new Error("The animation conversation result is invalid. Send the message again."), { statusCode: 400 });
  }
  if (value.baselineSignature !== dynamicsConversationSignature(conversation)) {
    throw Object.assign(new Error("This scene's animation conversation changed while the reply was being generated. Send the message again."), { statusCode: 409 });
  }
  return {
    id: text(value.id, 160),
    message: text(value.message, 1000),
    reply: text(value.reply),
    baselineSignature: value.baselineSignature,
    ...(value.needsClarification === true ? { needsClarification: true } : {}),
  };
}

export function appendDynamicsConversationTurn(conversation, turn, plan, now = new Date().toISOString()) {
  const current = normalizeDynamicsConversation(conversation);
  return {
    ...current,
    revision: current.revision + 1,
    updatedAt: now,
    messages: [
      ...current.messages,
      { id: `${turn.id}:user`, role: "user", content: turn.message, createdAt: now },
      {
        id: `${turn.id}:assistant`, role: "assistant", content: turn.reply, createdAt: now, plan: clone(plan),
        outcome: turn.needsClarification ? "clarification" : "accepted",
      },
    ],
  };
}
