// services/analytics.service.js
import Analytics from "../models/Analytics.js";

const today = () => new Date().toISOString().split("T")[0];

export const updateAnalytics = async ({ userId, label, action }) => {
  const date = today();

  let doc = await Analytics.findOne({ userId, date });
  if (!doc) doc = await Analytics.create({ userId, date });

  doc.totalEmails += 1;

  doc.labels.set(label, (doc.labels.get(label) || 0) + 1);

  doc.actions[action || "none"] += 1;

  await doc.save();
};