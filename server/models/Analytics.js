// models/Analytics.js
import mongoose from "mongoose";

export default mongoose.model("Analytics", new mongoose.Schema({
  userId: String,
  date: String,
  totalEmails: { type: Number, default: 0 },
  labels: { type: Map, of: Number, default: {} },
  actions: {
    reply: { type: Number, default: 0 },
    draft: { type: Number, default: 0 },
    none: { type: Number, default: 0 }
  }
}));