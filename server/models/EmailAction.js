import mongoose from "mongoose";

const ConversationItemSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["incoming", "outgoing"],
    required: true
  },
  type: {
    type: String, // "summary" for incoming email, "reply" or "draft" for outgoing
    default: "summary"
  },
  content: {
    type: String,
    required: true
  },
  messageId: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const EmailActionSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  sourceMessageId: { type: String, required: true },
  gmailMessageId: String,
  gmailDraftId: String,
  threadId: { type: String, index: true },
  type: {
    type: String,
    enum: ["reply", "draft"],
    required: true
  },
  label: String,
  to: String,
  subject: String,
  summary: { type: String, default: "" },
  body: String,
  conversationHistory: {
    type: [ConversationItemSchema],
    default: []
  },
  checked: { type: Boolean, default: false },
  checkedAt: Date,

  status: {
    type: String,
    enum: ["draft", "sending", "sent", "send_failed"],
    default: function () {
      return this.type === "reply" ? "sent" : "draft";
    }
  },
  sentAt: Date

}, { timestamps: true });

EmailActionSchema.index(
  { userId: 1, sourceMessageId: 1, type: 1 },
  { unique: true }
);

EmailActionSchema.index({ userId: 1, threadId: 1 });

export default mongoose.models.EmailAction || mongoose.model("EmailAction", EmailActionSchema);
