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

export const RecipientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: ""
    },
    email: {
      type: String,
      required: true
    }
  },
  { _id: false }
);

export const normalizeRecipientList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item) return null;
        if (typeof item === "string") {
          const trimmed = item.replace(/[\r\n]+/g, "").trim();
          if (!trimmed) return null;
          const match = trimmed.match(/^(?:["']?([^<"]*?)["']?\s*)?<([^>]+)>$/);
          if (match) {
            return { name: match[1]?.trim() || "", email: match[2]?.trim() || "" };
          }
          return { name: "", email: trimmed };
        }
        if (typeof item === "object" && item.email) {
          return {
            name: String(item.name || "").replace(/[\r\n]+/g, "").trim(),
            email: String(item.email || "").replace(/[\r\n]+/g, "").trim()
          };
        }
        return null;
      })
      .filter((r) => r && r.email);
  }
  if (typeof value === "string") {
    const raw = value.replace(/[\r\n]+/g, "").trim();
    if (!raw) return [];
    return raw
      .split(/[,;]/)
      .map((part) => {
        const trimmed = part.trim();
        if (!trimmed) return null;
        const match = trimmed.match(/^(?:["']?([^<"]*?)["']?\s*)?<([^>]+)>$/);
        if (match) {
          return { name: match[1]?.trim() || "", email: match[2]?.trim() || "" };
        }
        return { name: "", email: trimmed };
      })
      .filter((r) => r && r.email);
  }
  return [];
};

const OutgoingTurnSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["draft", "reply"]
    },
    to: {
      type: [RecipientSchema],
      default: [],
      set: normalizeRecipientList
    },
    cc: {
      type: [RecipientSchema],
      default: [],
      set: normalizeRecipientList
    },
    bcc: {
      type: [RecipientSchema],
      default: [],
      set: normalizeRecipientList
    },
    suggestedCc: {
      type: [RecipientSchema],
      default: [],
      set: normalizeRecipientList
    },
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
    references: String,
    generation: {
      mode: {
        type: String,
        default: null
      },
      model: String,
      instruction: String,
      useKnowledge: Boolean,
      ungrounded: Boolean,
      sources: [
        {
          docTitle: String
        }
      ],
      framing: {
        greeting: String,
        signOff: String
      },
      at: Date
    },
    versions: [
      {
        versionId: String,
        body: String,
        at: {
          type: Date,
          default: Date.now
        },
        source: {
          type: String,
          enum: ["ai_initial", "ai_revision", "manual_edit"]
        },
        instruction: String,
        useKnowledge: Boolean
      }
    ]
  },
  { _id: false }
);

const TurnSchema = new mongoose.Schema(
  {
    turnId: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString()
    },
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

EmailActionSchema.pre("init", function (doc) {
  if (doc && Array.isArray(doc.turns)) {
    for (let i = 0; i < doc.turns.length; i++) {
      const turn = doc.turns[i];
      if (turn) {
        if (!turn.turnId) {
          turn.turnId = turn._id?.toString() || turn.incomingMessageId || `turn-${i}`;
        }
        if (turn.outgoing) {
          turn.outgoing.to = normalizeRecipientList(turn.outgoing.to);
          turn.outgoing.cc = normalizeRecipientList(turn.outgoing.cc);
          turn.outgoing.bcc = normalizeRecipientList(turn.outgoing.bcc);
          turn.outgoing.suggestedCc = normalizeRecipientList(turn.outgoing.suggestedCc);
        }
      }
    }
  }
});

if (mongoose.models.EmailAction) {
  delete mongoose.models.EmailAction;
}

export default mongoose.model("EmailAction", EmailActionSchema);

