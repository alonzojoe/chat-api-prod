import mongoose from "mongoose";

const ConversationSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, index: true },
    therapistId: { type: String, required: true, index: true },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

ConversationSchema.index({ clientId: 1, therapistId: 1 }, { unique: true });

export const Conversation = mongoose.model("Conversation", ConversationSchema);
