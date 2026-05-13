import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    conversationId: { type: String, required: true, index: true },
    senderRole: { type: String, enum: ["patient", "therapist"], required: true },
    senderId: { type: String, required: true },
    body: { type: String, default: null },
    fileUrl: { type: String, default: null },
    fileName: { type: String, default: null },
    fileType: { type: String, default: null },
    seenAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

MessageSchema.index({ conversationId: 1, createdAt: -1 });

export const Message = mongoose.model("Message", MessageSchema);
