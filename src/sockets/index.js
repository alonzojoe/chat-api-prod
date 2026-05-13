import { assertActorInConversation } from "../services/conversationService.js";

export function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

export function actorRoom({ role, actorId }) {
  return `actor:${role}:${actorId}`;
}

export function registerSockets(io) {
  io.on("connection", (socket) => {
    socket.on("join:actor", async ({ role, actorId }) => {
      const actorRole = (role || "").toString();
      const actorStr = (actorId || "").toString();
      if (!actorStr.trim() || !["patient", "therapist"].includes(actorRole)) return;
      socket.join(actorRoom({ role: actorRole, actorId: actorStr.trim() }));
      socket.emit("actor:joined", { role: actorRole, actorId: actorStr.trim() });
    });

    socket.on("join", async ({ conversationId, role, actorId }) => {
      const id = (conversationId || "").toString();
      const actorRole = (role || "").toString();
      const actorStr = (actorId || "").toString();
      if (!id || !["patient", "therapist"].includes(actorRole) || !actorStr.trim()) return;

      const allowed = await assertActorInConversation({ conversationId: id, role: actorRole, actorId: actorStr.trim() });
      if (!allowed.ok) return;

      socket.join(conversationRoom(id));
      socket.join(actorRoom({ role: actorRole, actorId: actorStr.trim() }));
      socket.emit("joined", { conversationId: id });
    });
  });
}
