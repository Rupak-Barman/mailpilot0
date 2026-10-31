// routes/analytics.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import EmailAction from "../models/EmailAction.js";
import ProcessedEmail from "../models/ProcessedEmail.js";

const router = express.Router();

router.get("/", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { from, to } = req.query;
    const days = Number.parseInt(req.query.days, 10);

    let startDate = null;
    let endDate = null;

    if (from) {
      startDate = new Date(from);
    } else if (days && days > 0) {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      startDate.setDate(startDate.getDate() - (days - 1));
    }

    if (to) {
      endDate = new Date(to);
      endDate.setHours(23, 59, 59, 999);
    }

    // Build date filters
    const emailActionFilter = { userId };
    const processedNoneFilter = { userId, action: "none" };

    if (startDate || endDate) {
      const dateRange = {};
      if (startDate) dateRange.$gte = startDate;
      if (endDate) dateRange.$lte = endDate;

      emailActionFilter.createdAt = dateRange;
      processedNoneFilter.processedAt = dateRange;
    }

    const [
      draftsCount,
      repliesCount,
      noneCount,
      uncheckedCount,
      actionLabels,
      noneLabels,
      recentActions
    ] = await Promise.all([
      // Drafts: active unsent drafts
      EmailAction.countDocuments({
        ...emailActionFilter,
        type: "draft",
        status: "draft"
      }),

      // Replies: emails sent as replies
      EmailAction.countDocuments({
        ...emailActionFilter,
        $or: [{ status: "sent" }, { type: "reply" }]
      }),

      // No action taken
      ProcessedEmail.countDocuments(processedNoneFilter),

      // Unchecked items requiring review
      EmailAction.countDocuments({
        userId,
        checked: false
      }),

      // Category counts from EmailAction
      EmailAction.aggregate([
        { $match: emailActionFilter },
        { $group: { _id: "$label", count: { $sum: 1 } } }
      ]),

      // Category counts from ProcessedEmail
      ProcessedEmail.aggregate([
        { $match: processedNoneFilter },
        { $group: { _id: "$label", count: { $sum: 1 } } }
      ]),

      // Recent Activity feed: latest 10 email actions
      EmailAction.find({ userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .select("subject to label type status createdAt summary")
        .lean()
    ]);

    // Merge label counts into a unified dictionary
    const labels = {};
    for (const item of actionLabels) {
      if (item._id) {
        labels[item._id] = (labels[item._id] || 0) + item.count;
      }
    }
    for (const item of noneLabels) {
      if (item._id) {
        labels[item._id] = (labels[item._id] || 0) + item.count;
      }
    }

    const totalEmails = draftsCount + repliesCount + noneCount;

    const totals = {
      totalEmails,
      reply: repliesCount,
      draft: draftsCount,
      none: noneCount,
      unchecked: uncheckedCount,
      labels
    };

    return res.json({
      totals,
      recentActivity: recentActions,
      dateRange: {
        from: startDate?.toISOString() || null,
        to: endDate?.toISOString() || null
      }
    });
  } catch (error) {
    console.error("Analytics fetch error:", error);
    return res.status(500).json({ message: "Could not fetch analytics data." });
  }
});

export default router;
