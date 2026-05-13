import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { env } from "./config/env.js";
import { connectDb } from "./config/db.js";
import { createApp } from "./app.js";
import { registerSockets } from "./sockets/index.js";

const server = http.createServer();

const io = new SocketIOServer(
  server,
  env.enableCors ? { cors: { origin: env.corsOrigin, credentials: true } } : undefined
);

registerSockets(io);

const app = createApp({ io });
server.on("request", app);

// Bind HTTP before Mongo so /health works while DocumentDB connects (App Runner health checks).
server.listen(env.port, "0.0.0.0", () => {
  console.log(`Chat API listening on 0.0.0.0:${env.port}`);
  console.log(`Health: http://0.0.0.0:${env.port}/health`);
  void (async () => {
    try {
      await connectDb();
    } catch (err) {
      console.error("[db] connection failed", err);
      process.exit(1);
    }
  })();
});
