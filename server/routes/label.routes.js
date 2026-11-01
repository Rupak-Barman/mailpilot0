import express from "express";

import auth from "../middleware/auth.js";

import User from "../models/User.js";
import KnowledgeDocument from "../models/KnowledgeDocument.js";

import { getGmail } from "../services/gmail.service.js";

const router = express.Router();

const findUserLabel = (user, labelId) =>
  user?.labels.find(
    (label) =>
      String(label._id) === String(labelId) ||
      label.id === String(labelId)
  );

const normalizeKnowledgeIds = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  ];
};

/**
 * Ensure every selected knowledge document belongs to this user.
 * The IDs returned from this function are the same documentIds
 * that the RAG service uses to filter LanceDB retrieval.
 */
const validateKnowledgeIds = async (userId, values) => {
  const requestedIds = normalizeKnowledgeIds(values);

  if (requestedIds.length === 0) {
    return [];
  }

  const documents = await KnowledgeDocument.find({
    userId: String(userId),
    documentId: {
      $in: requestedIds
    }
  })
    .select("documentId")
    .lean();

  const validIds = new Set(
    documents.map((doc) => String(doc.documentId))
  );

  const invalidIds = requestedIds.filter(
    (id) => !validIds.has(id)
  );

  if (invalidIds.length > 0) {
    return null;
  }

  return requestedIds;
};

// Get all routing rules.
router.get("/", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("labels");

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    return res.json(user.labels || []);
  } catch (error) {
    console.error("Get labels error:", error);

    return res.status(500).json({
      message: "Could not fetch routing rules."
    });
  }
});

// Create a routing rule or update an existing rule with the same name.
router.post("/", auth, async (req, res) => {
  try {
    const {
      name,
      action,
      tone = "friendly",
      markAsRead,
      enabled = true,
      personaId = "",
      knowledgeDocumentIds = [],
      grounding,
      alwaysCc = []
    } = req.body;

    const cleanName = String(name || "").trim();

    const cleanTone = [
      "formal",
      "casual",
      "friendly"
    ].includes(tone)
      ? tone
      : "friendly";

    const cleanAction = {
      type: ["reply", "draft", "none"].includes(action?.type)
        ? action.type
        : "none",

      template: action?.template || ""
    };

    const cleanMarkAsRead =
      typeof markAsRead === "boolean"
        ? markAsRead
        : cleanAction.type !== "draft";

    const cleanEnabled =
      typeof enabled === "boolean" ? enabled : true;

    if (!cleanName) {
      return res.status(400).json({
        message: "Label name is required."
      });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    const cleanPersonaId = String(personaId || "");

    if (
      cleanPersonaId &&
      !user.personas.id(cleanPersonaId)
    ) {
      return res.status(400).json({
        message: "Selected writing persona was not found."
      });
    }

    const cleanKnowledgeIds = await validateKnowledgeIds(
      user._id,
      knowledgeDocumentIds
    );

    if (cleanKnowledgeIds === null) {
      return res.status(400).json({
        message: "One or more selected knowledge bases were not found."
      });
    }

    const cleanGrounding = ["strict", "flexible"].includes(grounding)
      ? grounding
      : (cleanKnowledgeIds.length > 0 ? "strict" : "flexible");

    const cleanAlwaysCc = Array.isArray(alwaysCc)
      ? [
          ...new Set(
            alwaysCc
              .map((e) => String(e || "").replace(/[\r\n]+/g, "").trim())
              .filter(Boolean)
          )
        ]
      : typeof alwaysCc === "string"
      ? [
          ...new Set(
            alwaysCc
              .split(/[,;]/)
              .map((e) => e.replace(/[\r\n]+/g, "").trim())
              .filter(Boolean)
          )
        ]
      : [];

    const existing = user.labels.find(
      (label) =>
        label.name.toLowerCase() === cleanName.toLowerCase()
    );

    // Update an existing rule instead of creating a duplicate.
    if (existing) {
      existing.tone = cleanTone;
      existing.markAsRead = cleanMarkAsRead;
      existing.enabled = cleanEnabled;
      existing.action = cleanAction;
      existing.personaId = cleanPersonaId;
      existing.knowledgeDocumentIds = cleanKnowledgeIds;
      existing.grounding = cleanGrounding;
      existing.alwaysCc = cleanAlwaysCc;

      await user.save();

      return res.json(existing);
    }

    // Create the actual Gmail label.
    const gmail = await getGmail(user);

    const response = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: cleanName
      }
    });

    const newLabel = {
      name: cleanName,
      id: response.data.id,
      tone: cleanTone,
      markAsRead: cleanMarkAsRead,
      enabled: cleanEnabled,
      action: cleanAction,
      personaId: cleanPersonaId,
      knowledgeDocumentIds: cleanKnowledgeIds,
      grounding: cleanGrounding,
      alwaysCc: cleanAlwaysCc
    };

    user.labels.push(newLabel);

    await user.save();

    return res.json(
      user.labels[user.labels.length - 1]
    );
  } catch (error) {
    console.error("Create label error:", error);

    return res.status(500).json({
      message:
        error.message || "Could not create routing rule."
    });
  }
});

// Update a routing rule.
router.patch("/:labelId", auth, async (req, res) => {
  try {
    const {
      action,
      tone,
      markAsRead,
      enabled,
      personaId,
      knowledgeDocumentIds,
      grounding,
      alwaysCc
    } = req.body;

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    const label = findUserLabel(user, req.params.labelId);

    if (!label) {
      return res.status(404).json({
        message: "Label not found."
      });
    }

    if (tone !== undefined) {
      label.tone = [
        "formal",
        "casual",
        "friendly"
      ].includes(tone)
        ? tone
        : label.tone;
    }

    if (action !== undefined) {
      label.action = {
        type: [
          "reply",
          "draft",
          "none"
        ].includes(action?.type)
          ? action.type
          : label.action?.type || "none",

        template:
          action?.template ||
          label.action?.template ||
          ""
      };
    }

    if (typeof markAsRead === "boolean") {
      label.markAsRead = markAsRead;
    }

    if (typeof enabled === "boolean") {
      label.enabled = enabled;
    }

    if (personaId !== undefined) {
      const cleanPersonaId = String(personaId || "");

      if (
        cleanPersonaId &&
        !user.personas.id(cleanPersonaId)
      ) {
        return res.status(400).json({
          message: "Selected writing persona was not found."
        });
      }

      label.personaId = cleanPersonaId;
    }

    if (knowledgeDocumentIds !== undefined) {
      const cleanKnowledgeIds = await validateKnowledgeIds(
        user._id,
        knowledgeDocumentIds
      );

      if (cleanKnowledgeIds === null) {
        return res.status(400).json({
          message: "One or more selected knowledge bases were not found."
        });
      }

      label.knowledgeDocumentIds = cleanKnowledgeIds;
    }

    if (["strict", "flexible"].includes(grounding)) {
      label.grounding = grounding;
    } else if (knowledgeDocumentIds !== undefined && grounding === undefined) {
      label.grounding = (label.knowledgeDocumentIds?.length || 0) > 0 ? "strict" : "flexible";
    }

    if (alwaysCc !== undefined) {
      label.alwaysCc = Array.isArray(alwaysCc)
        ? [
            ...new Set(
              alwaysCc
                .map((e) => String(e || "").replace(/[\r\n]+/g, "").trim())
                .filter(Boolean)
            )
          ]
        : typeof alwaysCc === "string"
        ? [
            ...new Set(
              alwaysCc
                .split(/[,;]/)
                .map((e) => e.replace(/[\r\n]+/g, "").trim())
                .filter(Boolean)
            )
          ]
        : [];
    }

    await user.save();

    return res.json(label);
  } catch (error) {
    console.error("Update label error:", error);

    return res.status(500).json({
      message:
        error.message || "Could not update routing rule."
    });
  }
});

// Permanently delete a routing rule.
router.delete("/:labelId", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    const label = findUserLabel(user, req.params.labelId);

    if (!label) {
      return res.status(404).json({
        message: "Label not found."
      });
    }

    const gmailLabelId = label.id;

    user.labels.pull({
      _id: label._id
    });

    // Delete the routing rule from MongoDB first.
    await user.save();

    // Try to remove the corresponding Gmail label.
    // A Gmail API failure must not restore the routing rule.
    if (gmailLabelId && user.refreshToken) {
      try {
        const gmail = await getGmail(user);

        await gmail.users.labels.delete({
          userId: "me",
          id: gmailLabelId
        });
      } catch (gmailError) {
        console.warn(
          "Routing rule deleted, but Gmail label could not be deleted:",
          gmailError.message
        );
      }
    }

    return res.json({
      message: "Routing rule deleted successfully.",
      labelId: req.params.labelId
    });
  } catch (error) {
    console.error("Label delete error:", error);

    return res.status(500).json({
      message: "Could not delete routing rule."
    });
  }
});

export default router;
