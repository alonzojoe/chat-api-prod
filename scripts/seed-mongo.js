import "dotenv/config";
import { connectDb } from "../src/config/db.js";
import { Conversation } from "../src/models/Conversation.js";
import { Message } from "../src/models/Message.js";

async function seed() {
  await connectDb();

  const wipe = process.argv.includes("--wipe");
  if (wipe) {
    await Message.deleteMany({});
    await Conversation.deleteMany({});
  }

  const convo1 = await Conversation.findOneAndUpdate(
    { clientId: "patient_1", therapistId: "therapist_10" },
    {
      $setOnInsert: {
        clientId: "patient_1",
        therapistId: "therapist_10",
      },
    },
    { new: true, upsert: true }
  );

  const convo2 = await Conversation.findOneAndUpdate(
    { clientId: "patient_2", therapistId: "therapist_10" },
    {
      $setOnInsert: {
        clientId: "patient_2",
        therapistId: "therapist_10",
      },
    },
    { new: true, upsert: true }
  );

  const existingMessages = await Message.countDocuments({});
  if (existingMessages === 0) {
    await Message.create([
      {
        conversationId: convo1._id.toString(),
        senderRole: "patient",
        senderId: "patient_1",
        body: "Hi doc. Can we chat here instead of calling?",
      },
      {
        conversationId: convo1._id.toString(),
        senderRole: "therapist",
        senderId: "therapist_10",
        body: "Yes. You can message and upload files here.",
      },
      {
        conversationId: convo2._id.toString(),
        senderRole: "patient",
        senderId: "patient_2",
        body: "Hello doc. I have a question before the appointment.",
      },
    ]);
  }

  const convoCount = await Conversation.countDocuments({});
  const msgCount = await Message.countDocuments({});

  console.log(`Seeded conversations: ${convoCount}`);
  console.log(`Seeded messages: ${msgCount}`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
