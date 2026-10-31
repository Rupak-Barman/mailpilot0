import mongoose from "mongoose";

const knowledgeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    fileName: {
      type: String,
      required: true
    },
    text: {
      type: String,
      required: true
    },
    embedding: {
      type: [Number],
      required: true
    }
  },
  { timestamps: true }
);

export default mongoose.model("Knowledge", knowledgeSchema);
