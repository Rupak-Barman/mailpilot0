// routes/analytics.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import EmailAction from "../models/EmailAction.js";
import ProcessedEmail from "../models/ProcessedEmail.js";

const router = express.Router();

export const handleGetAnalytics = async (req, res) => {
  try {
    const userId = String(req.user.id || req.user._id);
    const { from, to } = req.query;
    const days = Number.parseInt(req.query.days, 10);

    let startDate = null;
    let endDate = null;

    if (from && to) {
      startDate = new Date(from);
      endDate = new Date(to);
    } else if (from) {
      startDate = new Date(from);
      endDate = new Date();
      endDate.setUTCHours(23, 59, 59, 999);
    } else if (days && days > 0) {
      endDate = new Date();
      endDate.setUTCHours(23, 59, 59, 999);
      startDate = new Date();
      startDate.setUTCHours(0, 0, 0, 0);
      startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
    } else {
      // Default: last 7 days UTC
      endDate = new Date();
      endDate.setUTCHours(23, 59, 59, 999);
      startDate = new Date();
      startDate.setUTCHours(0, 0, 0, 0);
      startDate.setUTCDate(startDate.getUTCDate() - 6);
    }

    const dateRange = { $gte: startDate, $lte: endDate };

    // Query ProcessedEmail as the source of truth for all ingestion outcomes
    const baseFilter = { userId, createdAt: dateRange };

    const [
      totalProcessed,
      labeled,
      drafted,
      sent,
      failed,
      needsManual,
      resolvedManually,
      draftsPending,
      unchecked,
      labelAgg,
      recentActions
    ] = await Promise.all([
      // Total emails processed in date range
      ProcessedEmail.countDocuments(baseFilter),

      // Labeled
      ProcessedEmail.countDocuments({ ...baseFilter, outcome: "labeled" }),

      // Drafted
      ProcessedEmail.countDocuments({ ...baseFilter, outcome: "drafted" }),

      // Sent: Replies sent (using sentAt in range, never from EmailAction)
      ProcessedEmail.countDocuments({
        userId,
        outcome: "sent",
        sentAt: dateRange
      }),

      // Failed
      ProcessedEmail.countDocuments({ ...baseFilter, outcome: "failed" }),

      // Needs manual resolution
      ProcessedEmail.countDocuments({ ...baseFilter, outcome: "needs_manual" }),

      // Resolved manually (using resolvedAt in range, never from EmailAction turns)
      ProcessedEmail.countDocuments({
        userId,
        resolution: "manual",
        resolvedAt: dateRange
      }),

      // Drafts pending from EmailAction (where latest turn outgoing.status is "draft" or status is "draft")
      EmailAction.countDocuments({
        userId,
        $or: [
          { status: "draft" },
          { "turns.outgoing.status": "draft" }
        ]
      }),

      // Unchecked items: All time (do NOT filter by dateRange or updatedAt)
      EmailAction.countDocuments({
        userId,
        checked: false
      }),

      // Label distribution from ProcessedEmail in date range
      ProcessedEmail.aggregate([
        { $match: { ...baseFilter, label: { $exists: true, $ne: null } } },
        { $group: { _id: "$label", count: { $sum: 1 } } }
      ]),

      // Recent Activity feed: latest 10 email actions
      EmailAction.find({ userId })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(10)
        .select("subject to label type status createdAt updatedAt summary turns")
        .lean()
    ]);

    const labels = {};
    for (const item of (labelAgg || [])) {
      if (item._id) {
        labels[item._id] = item.count;
      }
    }

    // Format recentActivity to highlight failed/needs_manual and latest turn state
    const formattedRecentActivity = (recentActions || []).map((item) => {
      const latestTurn = item.turns && item.turns.length ? item.turns[item.turns.length - 1] : null;
      const turnOutcome = latestTurn?.outcome;
      const turnStatus = latestTurn?.outgoing?.status;

      let displayStatus = item.status;
      if (turnOutcome === "failed" || turnOutcome === "needs_manual") {
        displayStatus = turnOutcome;
      } else if (turnStatus) {
        displayStatus = turnStatus;
      }

      return {
        _id: item._id,
        subject: item.subject,
        to: item.to,
        label: item.label,
        type: item.type,
        status: displayStatus,
        outcome: turnOutcome || (item.status === "failed" ? "failed" : "none"),
        failureReason: latestTurn?.failureReason || null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        summary: item.summary
      };
    });

    const totals = {
      totalProcessed,
      totalEmails: totalProcessed, // alias for backwards compatibility
      labeled,
      drafted,
      draft: drafted, // alias
      sent,
      reply: sent, // alias
      none: Math.max(0, totalProcessed - (labeled + drafted + sent + failed + needsManual)),
      failed,
      needsManual,
      resolvedManually,
      draftsPending,
      unchecked,
      labels
    };

    return res.json({
      totals,
      recentActivity: formattedRecentActivity,
      dateRange: {
        from: startDate.toISOString(),
        to: endDate.toISOString()
      }
    });
  } catch (error) {
    console.error("Analytics fetch error:", error);
    return res.status(500).json({ message: "Could not fetch analytics data." });
  }
};

router.get("/", auth, handleGetAnalytics);

export default router;
