import express from "express";
import auth from "../middleware/auth.js";
import EmailAction from "../models/EmailAction.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import User from "../models/User.js";
import {
  getGmail,
  updateGmailDraft,
  deleteGmailDraft,
} from "../services/gmail.service.js";

const router = express.Router();

const asPositiveInt = (value, fallback, max = 100) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const getOrCreateGmailLabel = async (gmail, labelName) => {
  const { data } = await gmail.users.labels.list({
    userId: "me",
  });

  const labels = data.labels || [];

  const existingLabel = labels.find(
    (item) =>
      item.name.toLowerCase() === labelName.toLowerCase()
  );

  if (existingLabel) {
    if (existingLabel.type !== "user") {
      throw new Error(
        `"${labelName}" is a reserved Gmail system label. Use a custom label name.`
      );
    }

    return existingLabel.id;
  }

  const { data: createdLabel } = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });

  return createdLabel.id;
};



router.get("/summary", auth, async (req, res) => {
  const userId = req.user.id;

  const [unchecked, drafts, replies, total] = await Promise.all([
    EmailAction.countDocuments({ userId, checked: false }),
    EmailAction.countDocuments({ userId, type: "draft" }),
    EmailAction.countDocuments({ userId, type: "reply" }),
    EmailAction.countDocuments({ userId }),
  ]);

  res.json({ unchecked, drafts, replies, total });
});

router.get("/", auth, async (req, res) => {
  const { checked, type, label, q, status } = req.query;
  const page = asPositiveInt(req.query.page, 1, 10000);
  const limit = asPositiveInt(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const filter = { userId: req.user.id };

  if (checked === "true") filter.checked = true;
  if (checked === "false") filter.checked = false;
  if (["reply", "draft", "none", "failed"].includes(type)) filter.type = type;
  if (
    [
      "draft",
      "sending",
      "sent",
      "send_failed",
      "unread",
      "needs_reply",
      "failed",
      "reviewed"
    ].includes(status)
  ) {
    filter.status = status;
  }
  if (label) filter.label = label;
  if (q && q.trim()) {
    const escapedQ = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { subject: { $regex: escapedQ, $options: "i" } },
      { to: { $regex: escapedQ, $options: "i" } },
      { body: { $regex: escapedQ, $options: "i" } },
      { summary: { $regex: escapedQ, $options: "i" } },
      { "turns.incomingSubject": { $regex: escapedQ, $options: "i" } },
      { "turns.incomingSummary": { $regex: escapedQ, $options: "i" } },
      { "turns.outgoing.body": { $regex: escapedQ, $options: "i" } },
      { "turns.from": { $regex: escapedQ, $options: "i" } }
    ];
  }

  const [rawItems, total] = await Promise.all([
    EmailAction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    EmailAction.countDocuments(filter),
  ]);

  // Ensure response objects include both thread/turn structure and top-level fields
  const items = rawItems.map((doc) => {
    const obj = doc.toObject ? doc.toObject() : { ...doc };
    if (Array.isArray(obj.turns) && obj.turns.length > 0) {
      const latestTurn = obj.turns[obj.turns.length - 1];
      if (latestTurn.outgoing) {
        if (!obj.body) obj.body = latestTurn.outgoing.body || "";
        if (!obj.gmailDraftId && latestTurn.outgoing.gmailDraftId) {
          obj.gmailDraftId = latestTurn.outgoing.gmailDraftId;
        }
        if (!obj.gmailMessageId && latestTurn.outgoing.gmailMessageId) {
          obj.gmailMessageId = latestTurn.outgoing.gmailMessageId;
        }
      }
      if (!obj.summary && latestTurn.incomingSummary) {
        obj.summary = latestTurn.incomingSummary;
      }
    }
    return obj;
  });

  res.json({
    items,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
});

router.patch("/:id/label", auth, async (req, res) => {
  try {
    if (typeof req.body.label !== "string") {
      return res.status(400).json({
        message: "A valid label is required",
      });
    }

    const label = req.body.label.trim();

    if (label.length > 80) {
      return res.status(400).json({
        message: "Label cannot exceed 80 characters",
      });
    }

    const action = await EmailAction.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!action) {
      return res.status(404).json({
        message: "Draft not found",
      });
    }

    if (
      action.type !== "draft" ||
      (action.status && action.status !== "draft")
    ) {
      return res.status(409).json({
        message: "Only editable drafts can have their labels changed",
      });
    }

    if (!action.sourceMessageId) {
      return res.status(400).json({
        message: "Original Gmail message ID is missing",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user || !user.refreshToken) {
      return res.status(401).json({
        message: "Gmail connection is unavailable",
      });
    }

    const gmail = await getGmail(user);

    // Get existing Gmail labels
    const { data } = await gmail.users.labels.list({
      userId: "me",
    });

    const gmailLabels = data.labels || [];

    const previousLabel = (action.label || "").trim();

    // Find the previous custom Gmail label
    const oldGmailLabel = previousLabel
      ? gmailLabels.find(
        (item) =>
          item.name.toLowerCase() ===
          previousLabel.toLowerCase() &&
          item.type === "user"
      )
      : null;

    let newGmailLabelId = null;

    // Find or create the new Gmail label
    if (label) {
      newGmailLabelId = await getOrCreateGmailLabel(
        gmail,
        label
      );
    }

    const addLabelIds = [];
    const removeLabelIds = [];

    // Add new label
    if (newGmailLabelId) {
      addLabelIds.push(newGmailLabelId);
    }

    // Remove previous label if different
    if (
      oldGmailLabel &&
      oldGmailLabel.id !== newGmailLabelId
    ) {
      removeLabelIds.push(oldGmailLabel.id);
    }

    // Apply labels to the original Gmail message.
    // Gmail does not allow custom labels directly on drafts.
    if (addLabelIds.length || removeLabelIds.length) {
      await gmail.users.messages.modify({
        userId: "me",
        id: action.sourceMessageId,
        requestBody: {
          addLabelIds,
          removeLabelIds,
        },
      });
    }

    // Update MongoDB only after Gmail succeeds
    action.label = label;
    await action.save();

    return res.json({
      message: "Gmail and Mailpilot labels updated successfully",
      action,
    });

  } catch (error) {
    console.error("Update Gmail label error:", error);

    return res.status(500).json({
      message: error.message || "Could not update Gmail label",
    });
  }
});

router.post("/:id/send", auth, async (req, res) => {
  try {
    const action = await EmailAction.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!action) {
      return res.status(404).json({
        message: "Draft not found",
      });
    }

    // Determine the latest turn containing a draft
    let draftTurn = null;
    if (Array.isArray(action.turns) && action.turns.length > 0) {
      const lastTurn = action.turns[action.turns.length - 1];
      if (lastTurn && lastTurn.outgoing && lastTurn.outgoing.kind === "draft") {
        draftTurn = lastTurn;
      }
    }

    const isDraft = action.type === "draft" || (draftTurn && draftTurn.outgoing?.kind === "draft");
    if (!isDraft) {
      return res.status(400).json({
        message: "Only saved drafts can be sent here",
      });
    }

    const currentStatus = draftTurn ? draftTurn.outgoing.status : action.status;
    if (currentStatus === "sent") {
      return res.status(409).json({
        message: "This draft has already been sent",
      });
    }

    if (currentStatus === "sending" || currentStatus === "send_failed" || currentStatus === "failed") {
      return res.status(409).json({
        message: "Previous send attempt needs verification",
      });
    }

    const draftId = draftTurn?.outgoing?.gmailDraftId || action.gmailDraftId;
    if (!draftId) {
      return res.status(400).json({
        message: "Gmail draft ID is missing",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user || !user.refreshToken) {
      return res.status(401).json({
        message: "Gmail connection is unavailable",
      });
    }

    const gmail = await getGmail(user);

    // Atomically prevent double-clicks and duplicate sending.
    if (draftTurn) {
      draftTurn.outgoing.status = "sending";
    }
    action.status = "sending";
    await action.save();

    let sent;

    try {
      // Send the existing Gmail draft, not a newly constructed email.
      sent = await gmail.users.drafts.send({
        userId: "me",
        requestBody: {
          id: draftId,
        },
      });
    } catch (error) {
      console.error("Gmail draft sending failed:", error.message);

      // A Google API response confirms rejection.
      // A network failure can have an uncertain send outcome.
      const rollbackStatus = error.response ? "draft" : "failed";
      if (draftTurn) {
        draftTurn.outgoing.status = rollbackStatus;
      }
      action.status = error.response ? "draft" : "send_failed";
      await action.save().catch(() => {});

      return res.status(502).json({
        message: error.response
          ? "Gmail rejected the send request. The draft is still available."
          : "Send outcome is uncertain. Check Gmail Sent before retrying.",
      });
    }

    const sentMessageId = sent.data?.id || "";
    const now = new Date();

    if (draftTurn) {
      draftTurn.outgoing.status = "sent";
      draftTurn.outgoing.sentAt = now;
      draftTurn.outgoing.gmailMessageId = sentMessageId;
      draftTurn.outcome = "sent";
    }

    action.type = "reply";
    action.status = "sent";
    action.sentAt = now;
    action.gmailMessageId = sentMessageId;
    action.checked = true;
    action.checkedAt = now;

    await action.save();

    // Update ProcessedEmail whenever a draft is sent (sentAt, resolution "ai_draft_sent")
    const targetMessageId = draftTurn?.incomingMessageId || action.sourceMessageId;
    if (targetMessageId) {
      await ProcessedEmail.findOneAndUpdate(
        { userId: String(req.user.id), messageId: targetMessageId },
        {
          $set: {
            sentAt: now,
            resolution: "ai_draft_sent",
            resolvedAt: now,
          },
        },
      ).catch((err) => console.warn("[emailAction] Failed to update ProcessedEmail:", err.message));
    }

    return res.json({
      message: "Email sent successfully",
      action,
    });
  } catch (error) {
    console.error("Send draft error:", error.message);

    return res.status(500).json({
      message: "Could not send the draft",
    });
  }
});

router.patch("/:id/check", auth, async (req, res) => {
  const checked = req.body.checked !== false;

  const action = await EmailAction.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    {
      checked,
      checkedAt: checked ? new Date() : null,
    },
    { new: true },
  );

  if (!action) {
    return res.status(404).json({ message: "Email action not found" });
  }

  res.json(action);
});

// Update a draft in Gmail and synchronize its MongoDB record.
router.patch("/:id", auth, async (req, res) => {
  try {
    const { to, subject, body } = req.body;

    if (
      typeof to !== "string" ||
      !to.trim() ||
      typeof subject !== "string" ||
      typeof body !== "string"
    ) {
      return res.status(400).json({
        message: "Recipient, subject, and body are required",
      });
    }

    if (
      to.length > 1000 ||
      subject.length > 998 ||
      body.length > 100000
    ) {
      return res.status(400).json({
        message: "Draft content exceeds the allowed size",
      });
    }

    const action = await EmailAction.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!action) {
      return res.status(404).json({
        message: "Draft not found",
      });
    }

    // Determine the latest turn containing a draft
    let draftTurn = null;
    if (Array.isArray(action.turns) && action.turns.length > 0) {
      const lastTurn = action.turns[action.turns.length - 1];
      if (lastTurn && lastTurn.outgoing && lastTurn.outgoing.kind === "draft") {
        draftTurn = lastTurn;
      }
    }

    const isDraft = action.type === "draft" || (draftTurn && draftTurn.outgoing?.kind === "draft");
    if (!isDraft) {
      return res.status(400).json({
        message: "Only drafts can be edited",
      });
    }

    const currentStatus = draftTurn ? draftTurn.outgoing.status : action.status;
    if (currentStatus !== "draft") {
      return res.status(409).json({
        message: "Only unsent drafts can be edited",
      });
    }

    const draftId = draftTurn?.outgoing?.gmailDraftId || action.gmailDraftId;
    if (!draftId) {
      return res.status(400).json({
        message: "Gmail draft ID is missing",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user || !user.refreshToken) {
      return res.status(401).json({
        message: "Gmail connection is unavailable",
      });
    }

    const gmail = await getGmail(user);

    // Update the real Gmail draft first.
    const updatedDraft = await updateGmailDraft(gmail, {
      gmailDraftId: draftId,
      to: to.trim(),
      subject: subject.trim(),
      body,
      threadId: action.threadId,
    });

    // Synchronize latest turn if present
    if (draftTurn) {
      draftTurn.outgoing.body = body;
      draftTurn.from = to.trim();
      draftTurn.incomingSubject = subject.trim();
      if (updatedDraft.message?.id) {
        draftTurn.outgoing.gmailMessageId = updatedDraft.message.id;
      }
    }

    // Synchronize MongoDB top-level record with the edited content.
    action.to = to.trim();
    action.subject = subject.trim();
    action.body = body;

    // Gmail may return the underlying message ID.
    if (updatedDraft.message?.id) {
      action.gmailMessageId = updatedDraft.message.id;
    }

    await action.save();

    return res.json({
      message: "Draft updated successfully",
      action,
    });
  } catch (error) {
    console.error("Update draft error:", error.message);

    return res.status(502).json({
      message: "Could not update the Gmail draft",
    });
  }
});

// Delete the Gmail draft and its MongoDB record.
router.delete("/:id", auth, async (req, res) => {
  try {
    const action = await EmailAction.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!action) {
      return res.status(404).json({
        message: "Draft not found",
      });
    }

    // Determine the latest turn containing a draft
    let draftTurn = null;
    if (Array.isArray(action.turns) && action.turns.length > 0) {
      const lastTurn = action.turns[action.turns.length - 1];
      if (lastTurn && lastTurn.outgoing && lastTurn.outgoing.kind === "draft") {
        draftTurn = lastTurn;
      }
    }

    const isDraft = action.type === "draft" || (draftTurn && draftTurn.outgoing?.kind === "draft");
    if (!isDraft) {
      return res.status(400).json({
        message: "Only drafts can be deleted here",
      });
    }

    const currentStatus = draftTurn ? draftTurn.outgoing.status : action.status;
    if (currentStatus !== "draft") {
      return res.status(409).json({
        message: "Only unsent drafts can be deleted",
      });
    }

    const draftId = draftTurn?.outgoing?.gmailDraftId || action.gmailDraftId;
    if (!draftId) {
      return res.status(400).json({
        message: "Gmail draft ID is missing",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user || !user.refreshToken) {
      return res.status(401).json({
        message: "Gmail connection is unavailable",
      });
    }

    const gmail = await getGmail(user);

    // Delete from Gmail before removing the database record.
    await deleteGmailDraft(gmail, draftId);

    // If there are multiple turns in the thread, mark this draft as deleted
    // rather than deleting the whole thread history
    if (Array.isArray(action.turns) && action.turns.length > 1) {
      if (draftTurn) {
        draftTurn.outgoing.status = "deleted";
      }
      const prevTurn = action.turns[action.turns.length - 2];
      action.status = prevTurn?.outgoing?.status === "sent" ? "sent" : "reviewed";
      action.type = prevTurn?.outgoing?.kind || "reply";
      action.gmailDraftId = null;
      await action.save();
    } else {
      await EmailAction.deleteOne({
        _id: action._id,
        userId: req.user.id,
      });
    }

    return res.json({
      message: "Draft deleted successfully",
      id: action._id,
    });
  } catch (error) {
    console.error("Delete draft error:", error.message);

    return res.status(502).json({
      message: "Could not delete the Gmail draft",
    });
  }
});


export default router;

