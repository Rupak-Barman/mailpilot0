import mongoose from "mongoose";

const ConversationItemSchema = new mongoose.Schema(
  {
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
  },
  { _id: false }
);

const OutgoingTurnSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["draft", "reply"]
    },
    to: String,
    cc: String,
    bcc: String,
    subject: String,
    body: String, // plain text
    bodyHtml: String, // HTML version
    status: {
      type: String,
      // B6: includes "sending" and "superseded"
      enum: ["draft", "sending", "sent", "superseded", "deleted", "failed"]
    },
    gmailDraftId: String,
    gmailMessageId: String,
    rfcMessageId: String, // RFC Message-ID of the sent message
    sentAt: Date,
    sentFrom: {
      type: String,
      enum: ["app", "gmail"]
    },
    editedInGmail: {
      type: Boolean,
      default: false
    },
    editedAt: Date,
    lastReconciledAt: Date,
    createdAt: {
      type: Date,
      default: Date.now
    },
    composedManually: {
      type: Boolean,
      default: false
    },
    ungrounded: {
      type: Boolean,
      default: false
    },
    inReplyTo: String,
    references: String
  },
  { _id: false }
);

const TurnSchema = new mongoose.Schema(
  {
    // Incoming side
    incomingMessageId: String,
    gmailThreadId: String,
    rfcMessageId: String, // incoming Message-ID header
    inReplyToHeader: String,
    referencesHeader: String,
    linkedBy: {
      type: String,
      enum: ["thread", "headers", "sender"],
      default: "thread"
    },
    from: String, // real sender display name + address
    receivedAt: Date,
    incomingSubject: String,
    incomingSnippet: String,
    incomingSummary: String, // AI-generated
    label: String,

    // Outcome
    outcome: {
      type: String,
      enum: ["labeled", "drafted", "sent", "none", "failed", "needs_manual"]
    },
    failureReason: String,

    // Outgoing side (only present for draft/sent turns)
    outgoing: OutgoingTurnSchema,

    lastReconciledAt: Date
  },
  { _id: false }
);

const EmailActionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    threadId: {
      type: String,
      required: true
    },

    // Convenience top-level fields derived from latest turn
    // (NO origin field - tabs/badges derive from latest turn's outgoing.kind/status)
    status: {
      type: String,
      enum: [
        "unread",
        "draft",
        "sending",
        "sent",
        "needs_reply",
        "failed",
        "reviewed",
        "send_failed"
      ]
    },
    label: String,
    checked: {
      type: Boolean,
      default: false
    },
    type: {
      type: String,
      enum: ["draft", "reply", "none", "failed"]
    },

    turns: {
      type: [TurnSchema],
      default: []
    },

    // Legacy fields preserved so existing documents still load
    sourceMessageId: String,
    gmailMessageId: String,
    gmailDraftId: String,
    to: String,
    subject: String,
    summary: {
      type: String,
      default: ""
    },
    body: String,
    conversationHistory: {
      type: [ConversationItemSchema],
      default: []
    },
    checkedAt: Date,
    sentAt: Date
  },
  {
    timestamps: true,
    autoIndex: false
  }
);

EmailActionSchema.index({ "turns.gmailThreadId": 1 });
EmailActionSchema.index({ "turns.rfcMessageId": 1 });

if (mongoose.models.EmailAction) {
  delete mongoose.models.EmailAction;
}

export default mongoose.model("EmailAction", EmailActionSchema);

