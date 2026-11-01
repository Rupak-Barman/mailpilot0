import "./config/network.js";
import "./config/env.js";

import express from "express";
import passport from "./config/passport.js";
import { connectDB } from "./config/db.js";
import {
  createCorsMiddleware,
  createHelmetMiddleware,
  generalRateLimiter,
  authRateLimiter,
  sanitizeRequestMiddleware
} from "./config/security.js";
import { migrateTokens } from "./services/migration.service.js";

import authRoutes from "./routes/auth.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import { startPolling } from "./jobs/poll.job.js";
import labelRoutes from "./routes/label.routes.js";
import emailActionRoutes from "./routes/emailAction.routes.js";
import profileRoutes from "./routes/profile.routes.js";
import knowledgeRoutes from "./routes/knowledge.routes.js";
import personaRoutes from "./routes/persona.routes.js";
import syncRoutes from "./routes/sync.routes.js";
import eventsRoutes from "./routes/events.routes.js";
import fs from "node:fs";
import { checkOllamaHealth } from "./services/ollama.service.js";
import { registerShutdownHandlers } from "./services/shutdown.service.js";

const app = express();

// Security headers
app.use(createHelmetMiddleware());

// CORS restriction
app.use(createCorsMiddleware());

// Size-limited JSON body parser
app.use(express.json({ limit: "1mb" }));

// Boundary input sanitizer (strips $ and . keys from body, query, params)
app.use(sanitizeRequestMiddleware);

// Passport initialization
app.use(passport.initialize());

// Exempt endpoints: Health check and SSE Realtime Stream
// Note: /events is exempt from rate limiters and no compression middleware is attached
app.get("/health", (_, res) => res.send("OK"));
app.use("/events", eventsRoutes);
app.use("/api/events", eventsRoutes);

// Rate-limited routes
app.use("/auth", authRateLimiter, authRoutes);

// Apply general API rate limiter to data endpoints
app.use(generalRateLimiter);

app.use("/analytics", analyticsRoutes);
app.use("/labels", labelRoutes);
app.use("/email-actions", emailActionRoutes);
app.use("/profile", profileRoutes);
app.use("/knowledge", knowledgeRoutes);
app.use("/personas", personaRoutes);
app.use("/sync-status", syncRoutes);

// Central error handler
// Never log tokens, email bodies, or Authorization headers
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // Handle CORS rejections
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Not allowed by CORS" });
  }

  // Handle Mongoose CastError (invalid ObjectId)
  if (err.name === "CastError") {
    return res.status(400).json({ error: "Invalid resource identifier format" });
  }

  // Handle JSON parse error from express.json()
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Malformed JSON payload" });
  }

  // Handle payload too large
  if (err.type === "entity.too.large" || err.statusCode === 413) {
    return res.status(413).json({ error: "Request payload exceeds allowed limit" });
  }

  const statusCode = err.status || err.statusCode || 500;

  // Log only sanitized message, omitting stack traces in production and never logging secret data
  if (process.env.NODE_ENV !== "production") {
    console.error(`[error] ${err.name || "Error"}: ${err.message}`);
  } else {
    console.error(`[error] Internal error occurred (code ${statusCode})`);
  }

  const clientMessage =
    statusCode === 500 ? "Internal server error" : err.message || "An error occurred";

  res.status(statusCode).json({ error: clientMessage });
});

export const printStartupBanner = ({ HOST, PORT }) => {
  let version = "1.0.0";
  try {
    const pkg = JSON.parse(
      fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")
    );
    if (pkg.version) version = pkg.version;
  } catch {}

  const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
  const baseUrl = process.env.BASE_URL || `http://${HOST}:${PORT}`;
  const callbackUrl = `${baseUrl}/auth/google/callback`;
  const llmModel = process.env.OLLAMA_LLM_MODEL || "qwen2.5:7b";
  const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL || "embeddinggemma-2:270m";
  const syncEnabled = process.env.SYNC_ENABLED !== "false" ? "Enabled (cron every 1 min)" : "Disabled";

  console.log("");
  console.log("┌────────────────────────────────────────────────────────────────────────┐");
  console.log(`│  Mailpilot Email Agent  v${version.padEnd(46)}│`);
  console.log("├────────────────────────────────────────────────────────────────────────┤");
  console.log(`│  Backend API:      http://${HOST}:${PORT}`.padEnd(73) + "│");
  console.log(`│  Frontend Client:  ${clientUrl}`.padEnd(73) + "│");
  console.log(`│  OAuth Redirect:   ${callbackUrl}`.padEnd(73) + "│");
  console.log(`│  LLM Model:        ${llmModel}`.padEnd(73) + "│");
  console.log(`│  Embedding Model:  ${embeddingModel}`.padEnd(73) + "│");
  console.log(`│  Poll Interval:    every 1 min`.padEnd(73) + "│");
  console.log(`│  Sync Engine:      ${syncEnabled}`.padEnd(73) + "│");
  console.log("└────────────────────────────────────────────────────────────────────────┘");
  console.log("");
};

if (process.env.NODE_ENV !== "test") {
  connectDB().then(async () => {
    // 1. Boot-time idempotent token migration
    try {
      await migrateTokens();
    } catch (migErr) {
      console.error("[app] Token migration error:", migErr.message);
    }

    // 2. Ollama health check
    await checkOllamaHealth();

    // 3. Bind to HOST (default 127.0.0.1) and PORT
    const PORT = parseInt(process.env.PORT, 10) || 3000;
    const HOST = process.env.HOST || "127.0.0.1";

    const server = app.listen(PORT, HOST, () => {
      printStartupBanner({ HOST, PORT });
    });

    // 4. Register graceful shutdown handlers (SIGINT, SIGTERM, exceptions)
    registerShutdownHandlers(server);

    // 5. Start Gmail polling engine
    if (process.env.SYNC_ENABLED !== "false") {
      startPolling();
    }
  });
}

export default app;
