import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { parseActor } from "../utils/actor.js";
import { assertActorInConversation } from "../services/conversationService.js";
import { createFileMessage, createTextMessage, listMessages } from "../services/chatService.js";
import { getReadSummary, markMessagesSeen } from "../services/chatReadService.js";
import { actorRoom } from "../sockets/index.js";

export function createChatRouter({ io }) {
  const router = Router();

  // upload
  const uploadDir = path.resolve(process.cwd(), env.uploads.dir);
  fs.mkdirSync(uploadDir, { recursive: true });

  const s3Enabled = env.s3.enabled && Boolean(env.s3.bucket);

  const storage = s3Enabled
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadDir),
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname || "");
          const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
          cb(null, name);
        },
      });

  const upload = multer({
    storage,
    limits: { fileSize: env.uploads.maxFileSizeBytes },
  });

  const s3Client = s3Enabled
    ? new S3Client({
        region: env.s3.region,
        credentials:
          env.s3.accessKeyId && env.s3.secretAccessKey
            ? {
                accessKeyId: env.s3.accessKeyId,
                secretAccessKey: env.s3.secretAccessKey,
              }
            : undefined,
      })
    : null;

  function roomName(conversationId) {
    return `conversation:${conversationId}`;
  }

  // GET /api/chat/messages?conversationId=...&role=therapist&actorId=10
  router.get("/messages", async (req, res) => {
    const actor = parseActor(req);
    if (!actor.ok) return res.status(400).json({ error: actor.error });

    const conversationId = (req.query.conversationId || "").toString();
    if (!conversationId.trim()) return res.status(400).json({ error: "conversationId required" });

    const allowed = await assertActorInConversation({ conversationId, role: actor.role, actorId: actor.actorId });
    if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error });

    const messages = await listMessages({ conversationId });
    res.json({ messages });
  });

  // POST /api/chat/message
  router.post("/message", async (req, res) => {
    const actor = parseActor(req);
    if (!actor.ok) return res.status(400).json({ error: actor.error });

    const conversationId = (req.body.conversationId || "").toString();
    const body = (req.body.body || "").toString();

    if (!conversationId.trim()) return res.status(400).json({ error: "conversationId required" });
    if (!body.trim()) return res.status(400).json({ error: "body required" });

    const allowed = await assertActorInConversation({ conversationId, role: actor.role, actorId: actor.actorId });
    if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error });

    const message = await createTextMessage({
      conversationId: conversationId.trim(),
      senderRole: actor.role,
      senderId: actor.actorId,
      body: body.trim(),
    });

    io.to(roomName(conversationId)).emit("message:new", { message });

    const otherRole = actor.role === "patient" ? "therapist" : "patient";
    const otherActorId =
      actor.role === "patient" ? allowed.conversation.therapistId : allowed.conversation.clientId;
    if (otherActorId) {
      io.to(actorRoom({ role: otherRole, actorId: otherActorId.toString() })).emit("message:new", { message });
    }

    res.json({ message });
  });

  // POST /api/chat/upload (multipart)
  router.post("/upload", upload.single("file"), async (req, res) => {
    const actor = parseActor(req);
    if (!actor.ok) return res.status(400).json({ error: actor.error });

    const conversationId = (req.body.conversationId || "").toString();
    if (!conversationId.trim()) return res.status(400).json({ error: "conversationId required" });
    if (!req.file) return res.status(400).json({ error: "file required" });

    const allowed = await assertActorInConversation({ conversationId, role: actor.role, actorId: actor.actorId });
    if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error });

    let fileUrl = "";
    let publicUrl = "";

    if (s3Enabled) {
      if (!env.s3.region) return res.status(500).json({ error: "S3 region not configured" });
      const ext = path.extname(req.file.originalname || "");
      const key = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
      const base = env.s3.publicBaseUrl || `https://${env.s3.bucket}.s3.${env.s3.region}.amazonaws.com`;

      const putCommand = new PutObjectCommand({
        Bucket: env.s3.bucket,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      });

      await s3Client.send(putCommand);

      publicUrl = `${base}/${key}`;
      fileUrl = publicUrl;
    } else {
      const urlPath = `/uploads/${req.file.filename}`;
      const base = env.uploads.publicBaseUrl || `http://localhost:${env.port}`;
      publicUrl = `${base}${urlPath}`;
      fileUrl = urlPath;
    }

    const message = await createFileMessage({
      conversationId: conversationId.trim(),
      senderRole: actor.role,
      senderId: actor.actorId,
      fileUrl,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
    });

    io.to(roomName(conversationId)).emit("message:new", { message });

    const otherRole = actor.role === "patient" ? "therapist" : "patient";
    const otherActorId =
      actor.role === "patient" ? allowed.conversation.therapistId : allowed.conversation.clientId;
    if (otherActorId) {
      io.to(actorRoom({ role: otherRole, actorId: otherActorId.toString() })).emit("message:new", { message });
    }

    res.json({ message, publicUrl });
  });

  // POST /api/chat/read
  // body: { conversationId, lastReadMessageId? }
  // role + actorId come from parseActor (prototype)
  router.post("/read", async (req, res) => {
    const actor = parseActor(req);
    if (!actor.ok) return res.status(400).json({ error: actor.error });

    const conversationId = (req.body.conversationId || "").toString();
    const lastReadMessageId = (req.body.lastReadMessageId || "").toString();

    if (!conversationId.trim()) return res.status(400).json({ error: "conversationId required" });

    const allowed = await assertActorInConversation({ conversationId, role: actor.role, actorId: actor.actorId });
    if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error });

    const reads = await markMessagesSeen({
      conversationId: conversationId.trim(),
      role: actor.role,
      lastReadMessageId: lastReadMessageId.trim() || null,
    });

    io.to(roomName(conversationId)).emit("read:updated", { conversationId, reads });

    const otherRole = actor.role === "patient" ? "therapist" : "patient";
    const otherActorId =
      actor.role === "patient" ? allowed.conversation.therapistId : allowed.conversation.clientId;
    if (otherActorId) {
      io.to(actorRoom({ role: otherRole, actorId: otherActorId.toString() })).emit("read:updated", {
        conversationId,
        reads,
      });
    }

    res.json({ ok: true, reads });
  });

  // GET /api/chat/read?conversationId=...&role=therapist&actorId=... (optional helper)
  router.get("/read", async (req, res) => {
    const actor = parseActor(req);
    if (!actor.ok) return res.status(400).json({ error: actor.error });

    const conversationId = (req.query.conversationId || "").toString();
    if (!conversationId.trim()) return res.status(400).json({ error: "conversationId required" });

    const allowed = await assertActorInConversation({ conversationId, role: actor.role, actorId: actor.actorId });
    if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error });

    const reads = await getReadSummary({ conversationId: conversationId.trim(), role: actor.role });
    res.json({ reads });
  });

  return router;
}
