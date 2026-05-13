import { Message } from "../models/Message.js";

function formatDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function getOtherRole(role) {
  return role === "patient" ? "therapist" : "patient";
}

export async function getReadSummary({ conversationId, role }) {
  const otherRole = getOtherRole(role);
  const unreadCount = await Message.countDocuments({ conversationId, senderRole: otherRole, seenAt: null });

  const lastSeen = await Message.findOne({ conversationId, senderRole: otherRole, seenAt: { $ne: null } })
    .sort({ seenAt: -1 })
    .lean();

  return {
    conversationId: conversationId.toString(),
    unreadCount,
    lastSeenAt: formatDate(lastSeen?.seenAt),
  };
}

export async function markMessagesSeen({ conversationId, role, lastReadMessageId }) {
  const otherRole = getOtherRole(role);
  const filter = {
    conversationId,
    senderRole: otherRole,
    seenAt: null,
  };

  if (lastReadMessageId) {
    const lastRead = await Message.findById(lastReadMessageId).lean();
    if (lastRead?.createdAt) {
      filter.createdAt = { $lte: lastRead.createdAt };
    }
  }

  const result = await Message.updateMany(filter, { $set: { seenAt: new Date() } });

  const summary = await getReadSummary({ conversationId, role });
  return {
    ...summary,
    updatedCount: result?.modifiedCount ?? result?.nModified ?? 0,
  };
}
