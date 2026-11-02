// services/shutdown.service.js
import mongoose from "mongoose";
import { stopPolling, waitForInFlightPoll } from "../jobs/poll.job.js";
import { closeAllSSEConnections } from "../routes/events.routes.js";

let isShuttingDown = false;

export const _resetShutdownState = () => {
  isShuttingDown = false;
};

export const initiateShutdown = async ({
  signal = "SIGTERM",
  exitCode = 0,
  server = null,
  stopCron = stopPolling,
  closeSSE = closeAllSSEConnections,
  waitInFlight = waitForInFlightPoll,
  closeDB = async () => {
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  },
  exitFn = process.exit,
  timeoutMs = 10000,
  logger = console
} = {}) => {
  if (isShuttingDown) {
    logger.warn(`[shutdown] Received second signal (${signal}); forcing immediate termination.`);
    exitFn(1);
    return;
  }

  isShuttingDown = true;
  logger.log(`\n[shutdown] Graceful shutdown initiated (signal: ${signal})...`);

  // 1. Stop cron scheduler
  try {
    if (typeof stopCron === "function") {
      stopCron();
      logger.log("[shutdown] 1/4 Cron polling scheduler stopped.");
    }
  } catch (err) {
    logger.error(`[shutdown] Error stopping cron scheduler: ${err.message}`);
  }

  // 2. Close active SSE stream connections
  try {
    if (typeof closeSSE === "function") {
      closeSSE();
      logger.log("[shutdown] 2/4 Active SSE connections closed.");
    }
  } catch (err) {
    logger.error(`[shutdown] Error closing SSE connections: ${err.message}`);
  }

  // 3. Wait up to 10s for in-flight polling / email processing
  try {
    if (typeof waitInFlight === "function") {
      logger.log(`[shutdown] Waiting up to ${timeoutMs / 1000}s for in-flight email processing to complete...`);
      await waitInFlight(timeoutMs);
      logger.log("[shutdown] 3/4 In-flight processing completed or drained.");
    }
  } catch (err) {
    logger.error(`[shutdown] Error waiting for in-flight processing: ${err.message}`);
  }

  // Close HTTP server if running
  if (server && typeof server.close === "function") {
    await new Promise((resolve) => {
      server.close(() => {
        logger.log("[shutdown] HTTP server listener closed.");
        resolve();
      });
    });
  }

  // 4. Close MongoDB connection
  try {
    if (typeof closeDB === "function") {
      await closeDB();
      logger.log("[shutdown] 4/4 MongoDB connection closed.");
    }
  } catch (err) {
    logger.error(`[shutdown] Error closing MongoDB connection: ${err.message}`);
  }

  logger.log("[shutdown] Graceful shutdown complete. Exiting process.");
  exitFn(exitCode);
};

export const registerShutdownHandlers = (server) => {
  const onSignal = (signal) => {
    initiateShutdown({ signal, exitCode: 0, server });
  };

  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  process.on("uncaughtException", async (err) => {
    const msg = err && err.message ? err.message : String(err);
    console.error(`[fatal] Uncaught exception: ${msg}`);
    await initiateShutdown({ signal: "uncaughtException", exitCode: 1, server });
  });

  process.on("unhandledRejection", async (reason) => {
    const msg = reason && reason.message ? reason.message : String(reason);
    console.error(`[fatal] Unhandled promise rejection: ${msg}`);
    await initiateShutdown({ signal: "unhandledRejection", exitCode: 1, server });
  });
};

export default {
  initiateShutdown,
  registerShutdownHandlers,
  _resetShutdownState
};

