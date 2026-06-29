import { useMemoryStore } from "@/store/useMemoryStore";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { formatSize } from "@/lib/format";

export function GlobalMemoryChart() {
  const history = useMemoryStore((s) => s.history);
  const summary = useMemoryStore((s) => s.memorySummary);

  if (!summary || history.length < 2) {
    return null; // Not enough data to draw chart
  }

  // Format data for Recharts
  const data = history.map((point) => ({
    time: point.timestamp,
    used: point.totalUsed,
  }));

  const maxMemory = summary.total_physical;

  // Zoom the Y-axis to the data variance (min/max in history window) so small changes are visible.
  // Add ~500MB padding so lines don't hit the absolute edges.
  const padding = 500 * 1024 * 1024;
  const values = data.map((d) => d.used);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const chartMin = Math.max(0, minVal - padding);
  const chartMax = Math.min(maxMemory, maxVal + padding);

  return (
    <div className="h-24 w-full border-b bg-card/30 flex flex-col">
      <div className="px-3 pt-2 text-xs font-medium text-muted-foreground flex justify-between items-center z-10 relative">
        <span>Lịch sử sử dụng RAM (60s)</span>
        <span>{formatSize(data[data.length - 1]?.used || 0)} / {formatSize(maxMemory)}</span>
      </div>
      <div className="flex-1 -mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorUsed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="oklch(0.6 0.18 300)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="oklch(0.6 0.18 300)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis domain={[chartMin, chartMax]} hide />
            <XAxis dataKey="time" hide />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="rounded-lg border bg-background px-2 py-1 shadow-sm text-xs">
                      <span className="font-medium text-foreground">
                        {formatSize(payload[0].value as number)}
                      </span>
                    </div>
                  );
                }
                return null;
              }}
              cursor={{ stroke: "var(--color-muted-foreground)", strokeWidth: 1, strokeDasharray: "4 4" }}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="used"
              stroke="oklch(0.6 0.18 300)"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorUsed)"
              isAnimationActive={false} // Disable animation for realtime updates
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
