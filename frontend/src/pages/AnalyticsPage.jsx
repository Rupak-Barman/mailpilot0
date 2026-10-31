import { useState } from "react";
import { MetricCards } from "../features/analytics/MetricCards";
import { ActionBreakdown, LabelDistribution, RecentActivityFeed } from "../features/analytics/Charts";
import { Button } from "../components/common/Button";
import { LoadingState, ErrorState } from "../components/common/States";
import { useAnalytics } from "../hooks/useAnalytics";
import { useEmailActionSummary } from "../hooks/useEmailActions";

const ranges = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 }
];

export const AnalyticsPage = () => {
  const [days, setDays] = useState(7);
  const analytics = useAnalytics({ days });
  const summary = useEmailActionSummary();

  if (analytics.isLoading || summary.isLoading) return <LoadingState label="Loading analytics" />;
  if (analytics.error) return <ErrorState message="Could not load analytics." />;

  return (
    <div className="flex flex-col gap-5">
      {/* Header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">
            Analytics Overview
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Performance metrics and email processing trends.
          </p>
        </div>

        <div className="flex w-fit rounded-md border border-slate-200 bg-slate-50 p-1 dark:border-zinc-800 dark:bg-zinc-900">
          {ranges.map((range) => (
            <Button
              key={range.days}
              variant={days === range.days ? "subtle" : "ghost"}
              className="border-0"
              onClick={() => setDays(range.days)}
            >
              {range.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Metric cards */}
      <MetricCards totals={analytics.data?.totals} summary={summary.data} />

      {/* Main analytics grid: Recent Activity (left) + Breakdown & Distribution (right) */}
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <RecentActivityFeed items={analytics.data?.recentActivity || []} />
        </div>

        <div className="flex flex-col gap-5 lg:col-span-5">
          <ActionBreakdown totals={analytics.data?.totals} />
          <LabelDistribution labels={analytics.data?.totals?.labels || {}} />
        </div>
      </div>
    </div>
  );
};
