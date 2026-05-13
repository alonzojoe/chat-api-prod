import "dotenv/config";
import { connectDb } from "../src/config/db.js";
import { Conversation } from "../src/models/Conversation.js";

async function run() {
  await connectDb();

  const result = await Conversation.updateMany(
    {},
    { $unset: { clientName: "", therapistName: "" } }
  );

  console.log(
    `Updated conversations: matched=${result.matchedCount}, modified=${result.modifiedCount}`
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
