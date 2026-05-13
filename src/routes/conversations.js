import { Router } from "express";
import { parseActor } from "../utils/actor.js";
import { createConversation, listConversationsForActor } from "../services/conversationService.js";

export const conversationsRouter = Router();

// GET /api/conversations?role=therapist&actorId=10
conversationsRouter.get("/", async (req, res) => {
  const actor = parseActor(req);
  if (!actor.ok) return res.status(400).json({ error: actor.error });

  const conversations = await listConversationsForActor({ role: actor.role, actorId: actor.actorId });
  res.json({ conversations });
});

// POST /api/conversations
// { clientId, therapistId }
conversationsRouter.post("/", async (req, res) => {
  const clientId = (req.body.clientId || "").toString();
  const therapistId = (req.body.therapistId || "").toString();

  if (!clientId.trim()) return res.status(400).json({ error: "clientId required" });
  if (!therapistId.trim()) return res.status(400).json({ error: "therapistId required" });

  const result = await createConversation({
    clientId: clientId.trim(),
    therapistId: therapistId.trim(),
  });

  res.json({ ok: true, ...result });
});
