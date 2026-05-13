import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { Server as SocketIOServer } from "socket.io";
import request from "supertest";
import { createApp } from "../src/app.js";

test("GET /health returns 200", async () => {
  const server = http.createServer();
  const io = new SocketIOServer(server);
  const app = createApp({ io });
  const res = await request(app).get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});
