// config/db.js
import mongoose from "mongoose";

export const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.error("[db] MONGO_URI is missing. Cannot connect to database.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("DB connected");
};
