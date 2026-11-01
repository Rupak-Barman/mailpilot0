import mongoose from "mongoose";

const WritingPersonaSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },

    instructions: {
      type: String,
      default: "",
      maxlength: 4000
    },

    signature: {
      type: String,
      default: "",
      maxlength: 1000
    }
  },
  { timestamps: true }
);

const UserSchema = new mongoose.Schema({
  email: String,
  name: String,
  googleId: String,
  accessToken: String,
  refreshToken: String,
  profileDescription: {
    type: String,
    default: "",
    maxlength: 2000
  },

  gmailHistoryId: {
    type: String,
    default: null
  },
  syncStatus: {
    type: String,
    enum: ["idle", "running", "error"],
    default: "idle"
  },
  syncError: {
    type: String,
    default: null
  },
  lastSyncAt: {
    type: Date,
    default: null
  },
  needsRelogin: {
    type: Boolean,
    default: false
  },
  dailyReplySentCount: {
    type: Number,
    default: 0
  },
  dailyReplySentDate: {
    type: Date,
    default: null
  },

  settings: {
    groupBySender: {
      type: Boolean,
      default: false
    },
    defaultCc: {
      type: [String],
      default: []
    }
  },

  personas: {
    type: [WritingPersonaSchema],
    default: []
  },

  labels: [
    {
      name: String,
      id: String,

      // Tone is configured per routing rule.
      tone: {
        type: String,
        enum: ["formal", "casual", "friendly"],
        default: "friendly"
      },

      action: {
        type: {
          type: String,
          enum: ["reply", "draft", "none"],
          default: "none"
        },
        template: String
      },

      markAsRead: {
        type: Boolean,
        default: true
      },

      enabled: {
        type: Boolean,
        default: true
      },

      personaId: {
        type: String,
        default: ""
      },

      // These are actual KnowledgeDocument.documentId values,
      // never display names or filenames.
      knowledgeDocumentIds: {
        type: [String],
        default: []
      },

      alwaysCc: {
        type: [String],
        default: []
      },

      grounding: {
        type: String,
        enum: ["strict", "flexible"],
        default: function () {
          return this.knowledgeDocumentIds?.length > 0 ? "strict" : "flexible";
        }
      }
    }
  ]
});

export default mongoose.models.User ||
  mongoose.model("User", UserSchema);
