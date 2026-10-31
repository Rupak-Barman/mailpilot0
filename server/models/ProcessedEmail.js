// models/ProcessedEmail.js
import mongoose from "mongoose";

export default mongoose.model("ProcessedEmail", new mongoose.Schema({
  messageId: { type: String, required: true },
  userId: { type: String, required: true },
  processedAt: { type: Date, default: Date.now },
  label: String,
  action: String,
  markAsRead: Boolean
}).index({ userId: 1, messageId: 1 }, { unique: true }));
