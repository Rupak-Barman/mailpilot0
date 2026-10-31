import mongoose from "mongoose";

const EmailActionSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  sourceMessageId: { type: String, required: true },
  gmailMessageId: String,
  gmailDraftId: String,
  threadId: String,
  type: {
    type: String,
    enum: ["reply", "draft"],
    required: true
  },
  label: String,
  to: String,
  subject: String,
  body: String,
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

export default mongoose.model("EmailAction", EmailActionSchema);
