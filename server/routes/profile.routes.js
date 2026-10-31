import express from "express";
import auth from "../middleware/auth.js";
import User from "../models/User.js";
import EmailAction from "../models/EmailAction.js";

const router = express.Router();

const sanitizeDescription = (value) =>
  String(value || "")
    .trim()
    .slice(0, 2000);

router.get("/", auth, async (req, res) => {
  const user = await User.findById(req.user.id).select("name email profileDescription");

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  res.json({
    name: user.name,
    email: user.email,
    profileDescription: user.profileDescription || ""
  });
});

router.get("/settings", auth, async (req, res) => {
  const user = await User.findById(req.user.id).select("name email profileDescription labels personas");

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const [unchecked, drafts, replies, total] = await Promise.all([
    EmailAction.countDocuments({ userId: req.user.id, checked: false }),
    EmailAction.countDocuments({ userId: req.user.id, type: "draft" }),
    EmailAction.countDocuments({ userId: req.user.id, type: "reply" }),
    EmailAction.countDocuments({ userId: req.user.id })
  ]);

  res.json({
    profile: {
      name: user.name,
      email: user.email,
      profileDescription: user.profileDescription || ""
    },
    labels: user.labels,
    personas: user.personas || [],
    emailActionSummary: {
      unchecked,
      drafts,
      replies,
      total
    }
  });
});

router.patch("/", auth, async (req, res) => {
  const profileDescription = sanitizeDescription(req.body.profileDescription);

  const user = await User.findByIdAndUpdate(
    req.user.id,
    { profileDescription },
    {
      new: true,
      runValidators: true,
      select: "name email profileDescription"
    }
  );

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  res.json({
    name: user.name,
    email: user.email,
    profileDescription: user.profileDescription || ""
  });
});

export default router;
