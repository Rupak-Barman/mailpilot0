import mongoose from "mongoose";

const WritingPersonaSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  instructions: { type: String, default: "", maxlength: 4000 },
  tone: { type: String, enum: ["formal", "casual", "friendly", "technical"], default: "friendly" },
  signature: { type: String, default: "", maxlength: 1000 }
}, { timestamps: true });

const UserSchema = new mongoose.Schema({
  email: String,
  name: String,
  googleId: String,
  accessToken: String,
  refreshToken: String,
  profileDescription: { type: String, default: "", maxlength: 2000 },
  personas: { type: [WritingPersonaSchema], default: [] },
  labels: [{
    name: String,
    id: String,
    tone: { type: String, enum: ["formal", "casual", "friendly"], default: "friendly" },
    action: { type: { type: String, enum: ["reply", "draft", "none"], default: "none" }, template: String },
    markAsRead: { type: Boolean, default: true },
    enabled: { type: Boolean, default: true },
    personaId: { type: String, default: "" },
    knowledgeDocumentIds: { type: [String], default: [] }
  }]
});

export default mongoose.models.User || mongoose.model("User", UserSchema);
