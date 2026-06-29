import { useMemoryStore } from "@/store/useMemoryStore";
import { Line, LineChart, ResponsiveContainer, YAxis, Tooltip } from "recharts";
import { formatSize } from "@/lib/format";
import { Activity } from "lucide-react";

export function ProcessMemoryChart({ pid }: { pid: number }) {
  const history = useMemoryStore((s) => s.history);

  if (history.length < 2) {
    return null;
  }

  // Extract memory usage for this specific process over time
  const data = history.map((point) => ({
    time: point.timestamp,
    used: point.processUsage[pid] || 0,
  }));

  // If the process was just started or we have no data, skip
  if (data.every((d) => d.used === 0)) {
    return null;
  }

  // Calculate min/max for the Y axis to make small changes visible
  const values = data.map((d) => d.used).filter((v) => v > 0);
  const min = Math.min(...values) * 0.95; // 5% padding below
  const max = Math.max(...values) * 1.05; // 5% padding above

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5 text-green-500" />
        <span className="text-xs font-medium">Lịch sử RAM (60s)</span>
      </div>
      <div className="h-20 w-full rounded-md border bg-card/50 p-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <YAxis domain={[min, max]} hide />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="rounded border bg-background px-2 py-1 shadow-sm text-[10px]">
                      <span className="font-medium text-foreground">
                        {formatSize(payload[0].value as number)}
                      </span>
                    </div>
                  );
                }
                return null;
              }}
              cursor={{ stroke: "var(--color-muted-foreground)", strokeWidth: 1, strokeDasharray: "2 2" }}
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="used"
              stroke="oklch(0.65 0.18 250)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
