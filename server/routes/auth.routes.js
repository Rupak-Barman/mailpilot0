// routes/auth.routes.js
import express from "express";
import passport from "../config/passport.js";
import jwt from "jsonwebtoken";
import { createAuthCode, exchangeAuthCode } from "../services/authCode.service.js";
import { CLIENT_URL } from "../config/env.js";

const router = express.Router();

router.get(
  "/google",
  passport.authenticate("google", {
    scope: [
      "profile",
      "email",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.compose"
    ],
    accessType: "offline",
    prompt: "consent"
  })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { session: false }),
  (req, res) => {
    // Generate short-lived one-time authorization code
    const code = createAuthCode(req.user._id);
    const targetClientUrl = process.env.CLIENT_URL || CLIENT_URL || "http://localhost:5173";
    res.redirect(`${targetClientUrl}/auth/callback?code=${encodeURIComponent(code)}`);
  }
);

router.post("/exchange", (req, res) => {
  const { code } = req.body || {};
  if (!code) {
    return res.status(400).json({ error: "Authorization code is required" });
  }

  const userId = exchangeAuthCode(code);
  if (!userId) {
    return res.status(400).json({
      error: "Invalid, expired, or already used authorization code."
    });
  }

  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: "7d"
  });

  return res.json({ token });
});

router.post("/logout", (_req, res) => {
  return res.json({ ok: true });
});

export default router;
