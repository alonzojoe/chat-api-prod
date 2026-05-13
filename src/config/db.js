import mongoose from "mongoose";
import { env } from "./env.js";

let connected = false;

export async function connectDb() {
  if (connected) return;
  mongoose.set("strictQuery", true);
  const opts = { autoIndex: true };
  if (process.env.MONGO_TLS_CA_FILE) {
    opts.tls = true;
    opts.tlsCAFile = process.env.MONGO_TLS_CA_FILE;
  }
  await mongoose.connect(env.mongo.uri, opts);
  connected = true;
}
