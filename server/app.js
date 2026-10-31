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

dotenv.config();
const app = express();

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());
app.use(passport.initialize());

app.use("/auth", authRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/labels", labelRoutes);
app.use("/email-actions", emailActionRoutes);
app.use("/profile", profileRoutes);
app.use("/knowledge", knowledgeRoutes);
app.use("/personas", personaRoutes);
app.get("/health", (_, res) => res.send("OK"));

connectDB().then(() => {
  app.listen(3000, () => console.log("Server running"));
  startPolling();
});
