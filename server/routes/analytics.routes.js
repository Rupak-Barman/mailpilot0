// routes/analytics.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import Analytics from "../models/Analytics.js";

const router = express.Router();

const toDateString = (date) => date.toISOString().split("T")[0];

router.get("/", auth, async (req, res) => {
  const { from, to } = req.query;
  const days = Number.parseInt(req.query.days, 10);
  const filter = { userId: req.user.id };

  if (from || to || days) {
    filter.date = {};

    if (days && days > 0) {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - days + 1);
      filter.date.$gte = toDateString(start);
    }

    if (from) filter.date.$gte = from;
    if (to) filter.date.$lte = to;
  }

  const data = await Analytics.find(filter).sort({ date: 1 });
  const chartDays = data.map(item => ({
    date: item.date,
    totalEmails: item.totalEmails,
    reply: item.actions?.reply || 0,
    draft: item.actions?.draft || 0,
    none: item.actions?.none || 0,
    labels: Object.fromEntries(item.labels || [])
  }));

  const totals = chartDays.reduce((acc, day) => {
    acc.totalEmails += day.totalEmails;
    acc.reply += day.reply;
    acc.draft += day.draft;
    acc.none += day.none;

    for (const [label, count] of Object.entries(day.labels)) {
      acc.labels[label] = (acc.labels[label] || 0) + count;
    }

    return acc;
  }, { totalEmails: 0, reply: 0, draft: 0, none: 0, labels: {} });

  res.json({ days: chartDays, totals });
});

export default router;
