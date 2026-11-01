// config/db.js
import mongoose from "mongoose";

export const sanitizeMongoUri = (uri = "") => {
  return uri.replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)[^@]+(@.*)/i, "$1***$2");
};

export const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("\n================================================================================");
    console.error(" Mailpilot Database Error: MONGO_URI is missing");
    console.error("================================================================================");
    console.error(" Please configure MONGO_URI in server/.env (e.g. mongodb://127.0.0.1:27017/mailpilot)");
    console.error("================================================================================\n");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000
    });
    console.log("[db] MongoDB connected successfully");
  } catch (err) {
    console.error("\n================================================================================");
    console.error(" Mailpilot Database Error: Unable to connect to MongoDB");
    console.error("================================================================================");
    console.error(` Target URI: ${sanitizeMongoUri(uri)} (timeout: 5000ms)`);
    console.error(` Error:      ${err.message}`);
    console.error("\n Hint:");
    console.error("   Ensure MongoDB is installed and running locally, or start it via Docker:");
    console.error("     npm run db:up");
    console.error("================================================================================\n");
    process.exit(1);
  }
};
