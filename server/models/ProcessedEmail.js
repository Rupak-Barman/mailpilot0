// models/ProcessedEmail.js
import mongoose from "mongoose";

const ProcessedEmailSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true },
    userId: { type: String, required: true },
    processedAt: { type: Date, default: Date.now },
    label: String,
    action: String,
    markAsRead: Boolean,

    status: {
      type: String,
      enum: ["processing", "done", "failed", "retry"],
      default: "done"
    },
    outcome: {
      type: String,
      enum: [
        "labeled",
        "drafted",
        "sent",
        "none",
        "failed",
        "needs_manual",
        "skipped"
      ],
      default: "none"
    },
    failureReason: {
      type: String,
      default: null
    },
    attempts: {
      type: Number,
      default: 1
    },
    nextRetryAt: {
      type: Date,
      default: null
    },
    sentAt: {
      type: Date,
      default: null
    },
    resolvedAt: {
      type: Date,
      default: null
    },
    resolution: {
      type: String,
      enum: ["ai_draft_sent", "ai_reply_sent", "manual", "ai_assisted", "none"],
      default: null
    }
  },
  { timestamps: true }
);

ProcessedEmailSchema.index({ userId: 1, messageId: 1 }, { unique: true });

export default mongoose.models.ProcessedEmail ||
  mongoose.model("ProcessedEmail", ProcessedEmailSchema);
