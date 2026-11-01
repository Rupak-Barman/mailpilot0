import "./config/network.js";
// app.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import passport from "./config/passport.js";
import { connectDB } from "./config/db.js";
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
import { checkOllamaHealth } from "./services/ollama.service.js";

dotenv.config();
const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());
app.use(passport.initialize());

app.use("/auth", authRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/labels", labelRoutes);
app.use("/email-actions", emailActionRoutes);
app.use("/profile", profileRoutes);
app.use("/knowledge", knowledgeRoutes);
app.use("/personas", personaRoutes);
app.use("/sync-status", syncRoutes);
app.use("/events", eventsRoutes);
app.use("/api/events", eventsRoutes);
app.get("/health", (_, res) => res.send("OK"));

if (process.env.NODE_ENV !== "test") {
  connectDB().then(async () => {
    await checkOllamaHealth();
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, "127.0.0.1", () =>
      console.log(`Server running on http://127.0.0.1:${PORT}`)
    );
    startPolling();
  });
}

export default app;
