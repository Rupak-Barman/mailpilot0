import express from "express";
import auth from "../middleware/auth.js";
import User from "../models/User.js";
import { getGmail } from "../services/gmail.service.js";

const router = express.Router();

const findUserLabel = (user, labelId) =>
  user?.labels.find(label =>
    String(label._id) === labelId ||
    label.id === labelId
  );

router.get("/", auth, async (req, res) => {
  const user = await User.findById(req.user.id).select("labels");

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  res.json(user.labels);
});

router.post("/", auth, async (req, res) => {
  const { name, action, tone = "friendly", markAsRead, enabled = true, personaId = "", knowledgeDocumentIds = [] } = req.body;

  const cleanName = name?.trim();
  const cleanTone = ["formal", "casual", "friendly"].includes(tone)
    ? tone
    : "friendly";
  const cleanAction = {
    type: ["reply", "draft", "none"].includes(action?.type) ? action.type : "none",
    template: action?.template || ""
  };
  const cleanMarkAsRead = typeof markAsRead === "boolean"
    ? markAsRead
    : cleanAction.type !== "draft";
  const cleanEnabled = typeof enabled === "boolean" ? enabled : true;

  if (!cleanName) {
    return res.status(400).json({ message: "Label name is required" });
  }

  const user = await User.findById(req.user.id);
  const gmail = await getGmail(user);

  const existing = user.labels.find(l => l.name.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    existing.tone = cleanTone;
    existing.markAsRead = cleanMarkAsRead;
    existing.enabled = cleanEnabled;
    existing.action = cleanAction;
    existing.personaId = String(personaId || "");
    existing.knowledgeDocumentIds = Array.isArray(knowledgeDocumentIds) ? [...new Set(knowledgeDocumentIds.map(String))] : [];
    await user.save();
    return res.json(existing);
  }

  const resp = await gmail.users.labels.create({
    userId: "me",
    requestBody: { name: cleanName }
  });

  const newLabel = {
    name: cleanName,
    id: resp.data.id,
    tone: cleanTone,
    markAsRead: cleanMarkAsRead,
    enabled: cleanEnabled,
    action: cleanAction,
    personaId: String(personaId || ""),
    knowledgeDocumentIds: Array.isArray(knowledgeDocumentIds) ? [...new Set(knowledgeDocumentIds.map(String))] : []
  };

  user.labels.push(newLabel);
  await user.save();

  res.json(newLabel);
});

router.patch("/:labelId", auth, async (req, res) => {
  const { action, tone, markAsRead, enabled, personaId, knowledgeDocumentIds } = req.body;
  const user = await User.findById(req.user.id);
  const label = findUserLabel(user, req.params.labelId);

  if (!label) {
    return res.status(404).json({ message: "Label not found" });
  }

  if (tone) {
    label.tone = ["formal", "casual", "friendly"].includes(tone)
      ? tone
      : label.tone;
  }

  if (action) {
    label.action = {
      type: ["reply", "draft", "none"].includes(action.type) ? action.type : label.action?.type || "none",
      template: action.template || label.action?.template || ""
    };
  }

  if (typeof markAsRead === "boolean") {
    label.markAsRead = markAsRead;
  }

  if (typeof enabled === "boolean") { label.enabled = enabled; }
  if (personaId !== undefined) label.personaId = String(personaId || "");
  if (knowledgeDocumentIds !== undefined) label.knowledgeDocumentIds = Array.isArray(knowledgeDocumentIds) ? [...new Set(knowledgeDocumentIds.map(String))] : [];

  await user.save();
  res.json(label);
});

router.delete("/:labelId", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const label = findUserLabel(user, req.params.labelId);
    if (!label) return res.status(404).json({ message: "Label not found" });
    const gmailLabelId = label.id;
    user.labels.pull({ _id: label._id });
    await user.save();
    // Remove the corresponding Gmail user label too when possible. The routing rule
    // remains deleted even if Gmail refuses to delete a system/previously removed label.
    if (gmailLabelId && user.refreshToken) {
      try {
        const gmail = await getGmail(user);
        await gmail.users.labels.delete({ userId: "me", id: gmailLabelId });
      } catch (gmailError) {
        console.warn("Routing rule deleted, but Gmail label could not be deleted:", gmailError.message);
      }
    }
    return res.json({ message: "Routing rule deleted successfully", labelId: req.params.labelId });
  } catch (error) {
    console.error("Label delete error:", error);
    return res.status(500).json({ message: "Could not delete routing rule" });
  }
});

export default router;
