import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";

function formatDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function lastMessagePreview(message) {
  if (!message) return "";
  if (message.body) return message.body.slice(0, 80);
  if (message.fileUrl && message.fileType?.startsWith("image/")) return "[Image]";
  if (message.fileUrl) return "[Attachment]";
  return "";
}

export async function getConversationById(conversationId) {
  return Conversation.findById(conversationId).lean();
}

export async function getConversationByPair({ clientId, therapistId }) {
  return Conversation.findOne({ clientId, therapistId }).lean();
}

export async function assertActorInConversation({ conversationId, role, actorId }) {
  const convo = await getConversationById(conversationId);
  if (!convo) return { ok: false, status: 404, error: "Conversation not found" };

  const allowed =
    (role === "patient" && (convo.clientId || "").toString() === actorId) ||
    (role === "therapist" && (convo.therapistId || "").toString() === actorId);

  if (!allowed) return { ok: false, status: 403, error: "Not allowed for this conversation" };
  return { ok: true, conversation: convo };
}

export async function listConversationsForActor({ role, actorId }) {
  const filter = role === "therapist" ? { therapistId: actorId } : { clientId: actorId };

  const conversations = await Conversation.find(filter).sort({ updatedAt: -1 }).lean();

  const rows = await Promise.all(
    conversations.map(async (convo) => {
      const lastMessage = await Message.findOne({ conversationId: convo._id.toString() })
        .sort({ createdAt: -1 })
        .lean();

      const otherRole = role === "therapist" ? "patient" : "therapist";
      const unreadCount = await Message.countDocuments({
        conversationId: convo._id.toString(),
        senderRole: otherRole,
        seenAt: null,
      });

      return {
        conversationId: convo._id.toString(),
        clientId: convo.clientId,
        therapistId: convo.therapistId,
        lastMessage: lastMessagePreview(lastMessage),
        lastMessageAt: formatDate(lastMessage?.createdAt),
        unreadCount,
      };
    })
  );

  return rows.sort((a, b) => {
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });
}

export async function createConversation({ clientId, therapistId }) {
  const existing = await getConversationByPair({ clientId, therapistId });
  if (existing) return { id: existing._id.toString(), existing: true };

  const created = await Conversation.create({
    clientId,
    therapistId,
  });

  return { id: created._id.toString(), existing: false };
}
