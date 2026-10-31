import { useState } from "react";
import { MetricCards } from "../features/analytics/MetricCards";
import { ActionBreakdown, LabelDistribution, VolumeTrendChart } from "../features/analytics/Charts";
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
    <div className="flex flex-col gap-3 xl:h-[calc(100vh-5rem)] xl:overflow-hidden">
      {/* Header row - compact */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-2xl">
            Analytics Overview
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Performance metrics and email processing trends.</p>
        </div>
        <div className="flex w-fit rounded-md border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
          {ranges.map(range => (
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

      {/* Metric cards row */}
      <MetricCards totals={analytics.data?.totals} summary={summary.data} />

      {/* Charts row - all 3 panels side-by-side on desktop */}
      <div className="grid flex-1 gap-3 xl:grid-cols-[5fr_2fr_3fr] xl:min-h-0">
        <VolumeTrendChart days={analytics.data?.days || []} />
        <ActionBreakdown totals={analytics.data?.totals} />
        <LabelDistribution labels={analytics.data?.totals?.labels || {}} />
      </div>
    </div>
  );
};
