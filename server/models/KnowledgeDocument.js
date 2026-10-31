import mongoose from "mongoose";
const schema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  documentId: { type: String, required: true, unique: true, index: true },
  fileName: { type: String, required: true },
  chunks: { type: Number, default: 0 },
  mimeType: { type: String, default: "application/pdf" }
}, { timestamps: true });
schema.index({ userId: 1, fileName: 1 });
export default mongoose.models.KnowledgeDocument || mongoose.model("KnowledgeDocument", schema);
