// config/db.js
import 'dotenv/config'; 
import mongoose from "mongoose";

export const connectDB = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("DB connected");
};