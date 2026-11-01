import express from "express";

import auth from "../middleware/auth.js";
import User from "../models/User.js";
import EmailAction from "../models/EmailAction.js";

const router = express.Router();

// Basic account information.
router.get("/", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("name email");

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    return res.json({
      name: user.name,
      email: user.email
    });
  } catch (error) {
    console.error("Get profile error:", error);

    return res.status(500).json({
      message: "Could not fetch profile."
    });
  }
});

// Data required by the Profile & Rules page.
router.get("/settings", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("name email labels personas");

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    const [
      unchecked,
      drafts,
      replies,
      total
    ] = await Promise.all([
      EmailAction.countDocuments({
        userId: req.user.id,
        checked: false
      }),

      EmailAction.countDocuments({
        userId: req.user.id,
        type: "draft"
      }),

      EmailAction.countDocuments({
        userId: req.user.id,
        type: "reply"
      }),

      EmailAction.countDocuments({
        userId: req.user.id
      })
    ]);

    return res.json({
      profile: {
        name: user.name,
        email: user.email
      },

      labels: user.labels || [],
      personas: user.personas || [],

      emailActionSummary: {
        unchecked,
        drafts,
        replies,
        total
      }
    });
  } catch (error) {
    console.error("Get profile settings error:", error);

    return res.status(500).json({
      message: "Could not fetch profile settings."
    });
  }
});

export default router;
