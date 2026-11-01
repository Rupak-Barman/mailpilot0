// routes/events.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import { subscribeUserEvents } from "../services/events.service.js";

const router = express.Router();

export const handleEventsStream = (req, res) => {
  const userId = req.user?.id || req.user?._id;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  // Initial comment to establish stream
  res.write(": connected\n\n");
  if (typeof res.flush === "function") {
    res.flush();
  }

  const onEvent = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (typeof res.flush === "function") {
        res.flush();
      }
    } catch (err) {
      console.warn("[events] Error writing event to client:", err.message);
    }
  };

  const unsubscribe = subscribeUserEvents(userId, onEvent);

  // Send a ": ping" comment every 25 seconds
  const pingInterval = setInterval(() => {
    try {
      res.write(": ping\n\n");
      if (typeof res.flush === "function") {
        res.flush();
      }
    } catch {
      clearInterval(pingInterval);
    }
  }, 25000);

  // Clean up when client disconnects or request finishes
  let isCleanedUp = false;
  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    clearInterval(pingInterval);
    unsubscribe();
  };

  req.on("close", cleanup);
  res.on("close", cleanup);
  req.on("end", cleanup);
};

router.get("/", auth, handleEventsStream);

export default router;
