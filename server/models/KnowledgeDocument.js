// import mongoose from "mongoose";
// const schema = new mongoose.Schema({
//   userId: { type: String, required: true, index: true },
//   documentId: { type: String, required: true, unique: true, index: true },
//   fileName: { type: String, required: true },
//   chunks: { type: Number, default: 0 },
//   mimeType: { type: String, default: "application/pdf" }
// }, { timestamps: true });
// schema.index({ userId: 1, fileName: 1 });
// export default mongoose.models.KnowledgeDocument || mongoose.model("KnowledgeDocument", schema);

import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },

    documentId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    // Original uploaded PDF filename.
    fileName: {
      type: String,
      required: true
    },

    // Custom name shown in the application.
    // Empty for legacy records; the UI falls back to fileName.
    displayName: {
      type: String,
      trim: true,
      default: "",
      maxlength: 100
    },

    chunks: {
      type: Number,
      default: 0
    },

    mimeType: {
      type: String,
      default: "application/pdf"
    }
  },
  { timestamps: true }
);

schema.index({ userId: 1, fileName: 1 });

export default mongoose.models.KnowledgeDocument ||
  mongoose.model("KnowledgeDocument", schema);