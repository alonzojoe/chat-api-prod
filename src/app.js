//app.js
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { env } from "./config/env.js";
import { conversationsRouter } from "./routes/conversations.js";
import { createChatRouter } from "./routes/chat.js";

export function createApp({ io }) {
  const app = express();

  const corsOrigins = (env.corsOrigin || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  if (env.enableCors) {
    app.use(
      cors({
        origin: (origin, callback) => {
          if (!origin) return callback(null, true); // allow non-browser tools
          if (corsOrigins.includes("*")) return callback(null, true);
          if (corsOrigins.includes(origin)) return callback(null, true);
          return callback(new Error("CORS blocked"));
        },
        credentials: true,
      })
    );
  }
  app.use(express.json({ limit: "2mb" }));

  app.use(
    rateLimit({
      windowMs: env.rateLimit.windowMs,
      max: env.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // simple API key auth (optional)
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (req.path.startsWith('/uploads')) return next();
    if (req.path === '/health') return next();
    if (!env.authKey) return next();
    const key = req.header('x-auth-key');
    if (key && key === env.authKey) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  });

  // uploads static
  const uploadDir = path.resolve(process.cwd(), env.uploads.dir);
  fs.mkdirSync(uploadDir, { recursive: true });
  app.use("/uploads", express.static(uploadDir));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/conversations", conversationsRouter);
  app.use("/api", createChatRouter({ io }));

  // basic error handler
  app.use((err, req, res, _next) => {
    console.error("[error]", err);
    res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
  });

  return app;
}
