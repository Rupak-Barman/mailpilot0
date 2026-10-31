import express from "express";
import auth from "../middleware/auth.js";
import EmailAction from "../models/EmailAction.js";
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
  const { checked, type, label, q } = req.query;
  const page = asPositiveInt(req.query.page, 1, 10000);
  const limit = asPositiveInt(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const filter = { userId: req.user.id };

  if (checked === "true") filter.checked = true;
  if (checked === "false") filter.checked = false;
  if (["reply", "draft"].includes(type)) filter.type = type;
  if (label) filter.label = label;
  if (q) {
    filter.$or = [
      { subject: { $regex: q, $options: "i" } },
      { to: { $regex: q, $options: "i" } },
      { body: { $regex: q, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    EmailAction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    EmailAction.countDocuments(filter),
  ]);

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

    if (action.type !== "draft") {
      return res.status(400).json({
        message: "Only saved drafts can be sent here",
      });
    }

    if (action.status === "sent") {
      return res.status(409).json({
        message: "This draft has already been sent",
      });
    }

    if (action.status === "sending" || action.status === "send_failed") {
      return res.status(409).json({
        message: "Previous send attempt needs verification",
      });
    }

    if (!action.gmailDraftId) {
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
    const claimed = await EmailAction.findOneAndUpdate(
      {
        _id: action._id,
        userId: req.user.id,
        type: "draft",
        $or: [{ status: "draft" }, { status: { $exists: false } }],
      },
      {
        $set: { status: "sending" },
      },
      { new: true },
    );

    if (!claimed) {
      return res.status(409).json({
        message: "Draft is already being sent or has been sent",
      });
    }

    let sent;

    try {
      // Send the existing Gmail draft, not a newly constructed email.
      sent = await gmail.users.drafts.send({
        userId: "me",
        requestBody: {
          id: claimed.gmailDraftId,
        },
      });
    } catch (error) {
      console.error("Gmail draft sending failed:", error.message);

      // A Google API response confirms rejection.
      // A network failure can have an uncertain send outcome.
      await EmailAction.updateOne(
        { _id: claimed._id, status: "sending" },
        {
          $set: {
            status: error.response ? "draft" : "send_failed",
          },
        },
      );

      return res.status(502).json({
        message: error.response
          ? "Gmail rejected the send request. The draft is still available."
          : "Send outcome is uncertain. Check Gmail Sent before retrying.",
      });
    }

    const updated = await EmailAction.findOneAndUpdate(
      {
        _id: claimed._id,
        userId: req.user.id,
      },
      {
        $set: {
          type: "reply",
          status: "sent",
          sentAt: new Date(),
          gmailMessageId: sent.data.id,
          checked: true,
          checkedAt: new Date(),
        },
      },
      { new: true },
    );

    return res.json({
      message: "Email sent successfully",
      action: updated,
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

    if (action.type !== "draft") {
      return res.status(400).json({
        message: "Only drafts can be edited",
      });
    }

    if (action.status !== "draft") {
      return res.status(409).json({
        message: "Only unsent drafts can be edited",
      });
    }

    if (!action.gmailDraftId) {
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
      gmailDraftId: action.gmailDraftId,
      to: to.trim(),
      subject: subject.trim(),
      body,
      threadId: action.threadId,
    });

    // Synchronize MongoDB with the edited content.
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

    if (action.type !== "draft") {
      return res.status(400).json({
        message: "Only drafts can be deleted here",
      });
    }

    if (action.status !== "draft") {
      return res.status(409).json({
        message: "Only unsent drafts can be deleted",
      });
    }

    if (!action.gmailDraftId) {
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
    await deleteGmailDraft(gmail, action.gmailDraftId);

    await EmailAction.deleteOne({
      _id: action._id,
      userId: req.user.id,
      type: "draft",
      status: "draft",
    });

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

