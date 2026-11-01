// routes/sync.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import { isOllamaReachable } from "../services/ollama.service.js";

const router = express.Router();

export const handleGetSyncStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "syncStatus syncError lastSyncAt needsRelogin"
    );

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const [queueSize, ollamaReachable] = await Promise.all([
      ProcessedEmail.countDocuments({
        userId: String(req.user.id),
        status: { $in: ["processing", "retry"] }
      }),
      isOllamaReachable()
    ]);

    const status = user.syncStatus || "idle";
    const lastSync = user.lastSyncAt || null;
    const error = user.syncError || null;
    const needsRelogin = Boolean(user.needsRelogin);

    return res.json({
      status,
      lastSync,
      error,
      needsRelogin,
      queueSize,
      ollamaReachable
    });
  } catch (err) {
    console.error("Get sync-status error:", err);
    return res.status(500).json({ message: "Could not fetch sync status." });
  }
};

router.get("/", auth, handleGetSyncStatus);
router.get("/sync-status", auth, handleGetSyncStatus);

export default router;
