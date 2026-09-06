import { createHash, randomUUID } from "node:crypto";

export const TRANSITIONS_CONVERSATION_SCHEMA_VERSION = "storyvr-transitions-conversation/v1";

export function transitionsStoreForReader(value) {
  const { conversationsByBoundary: _conversation, ...runtime } = value || {};
  return runtime;
}

function text(value, maximum = 4000) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maximum) : "";
}

function clone(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

export function normalizeTransitionsConversation(value) {
  const source = value && typeof value === "object" ? value : {};
  const messages = (Array.isArray(source.messages) ? source.messages : []).flatMap((message) => {
    if (!["user", "assistant"].includes(message?.role)) return [];
    const content = text(message.content, message.role === "user" ? 2000 : 4000);
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
    schemaVersion: TRANSITIONS_CONVERSATION_SCHEMA_VERSION,
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    updatedAt: text(source.updatedAt, 80) || null,
    messages,
  };
}

export function normalizeTransitionsConversations(value, contexts = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !contexts || Object.hasOwn(contexts, key))
    .map(([key, conversation]) => [key, normalizeTransitionsConversation(conversation)]));
}

export function transitionsConversationForBoundary(store, boundaryKey, previousPlan = null) {
  if (Object.hasOwn(store?.conversationsByBoundary || {}, boundaryKey)) {
    return normalizeTransitionsConversation(store.conversationsByBoundary[boundaryKey]);
  }
  const conversation = normalizeTransitionsConversation(null);
  if (!previousPlan) return conversation;
  conversation.messages = [
    {
      id: "legacy-user",
      role: "user",
      content: text(previousPlan.prompt, 2000) || "Use the transition already saved in this boundary.",
      createdAt: null,
    },
    {
      id: "legacy-assistant",
      role: "assistant",
      content: "This is the previously saved transition. Further messages can refine it.",
      createdAt: null,
      plan: clone(previousPlan),
      outcome: "accepted",
    },
  ];
  return conversation;
}

export function transitionsConversationSignature(conversation) {
  return createHash("sha256").update(JSON.stringify(normalizeTransitionsConversation(conversation))).digest("hex");
}

export function createTransitionsConversationTurn(conversation, message, reply, { needsClarification = false } = {}) {
  return {
    id: randomUUID(),
    message: text(message, 2000),
    reply: text(reply) || "Updated the transition using your message and the saved scenes.",
    baselineSignature: transitionsConversationSignature(conversation),
    ...(needsClarification ? { needsClarification: true } : {}),
  };
}

export function validateTransitionsConversationTurn(value, conversation, prompt) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !text(value.id, 160) || !text(value.message, 2000) || !text(value.reply)
    || text(value.message, 2000) !== text(prompt, 2000)) {
    throw Object.assign(new Error("The transition conversation result is invalid. Send the message again."), { statusCode: 400 });
  }
  if (value.baselineSignature !== transitionsConversationSignature(conversation)) {
    throw Object.assign(new Error("This boundary's transition conversation changed while the reply was being generated. Send the message again."), { statusCode: 409 });
  }
  return {
    id: text(value.id, 160),
    message: text(value.message, 2000),
    reply: text(value.reply),
    baselineSignature: value.baselineSignature,
    ...(value.needsClarification === true ? { needsClarification: true } : {}),
  };
}

export function appendTransitionsConversationTurn(conversation, turn, plan, now = new Date().toISOString()) {
  const current = normalizeTransitionsConversation(conversation);
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
