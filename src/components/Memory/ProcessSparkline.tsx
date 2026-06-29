import { useMemoryStore } from "@/store/useMemoryStore";
import { useMemo } from "react";

export function ProcessSparkline({ pid, color }: { pid: number; color: string }) {
  const history = useMemoryStore((s) => s.history);

  const pathDef = useMemo(() => {
    if (history.length < 2) return null;

    const data = history.map((h) => h.processUsage[pid] || 0);

    // Skip drawing if empty
    if (data.every((d) => d === 0)) return null;

    const min = Math.min(...data);
    const max = Math.max(...data);
    // At least 1MB range so tiny 4KB page allocations don't look like massive spikes
    const range = Math.max(max - min, 1024 * 1024);

    const width = 64;
    const height = 16;

    let d = "";
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * width;
      let y = height;
      if (range > 0) {
        // Leave 1px padding top and bottom
        y = height - ((data[i] - min) / range) * (height - 2) - 1;
      } else {
        y = height / 2;
      }

      if (i === 0) d += `M ${x} ${y}`;
      else d += ` L ${x} ${y}`;
    }
    return d;
  }, [history, pid]);

  if (!pathDef) {
    return <div className="w-16 h-4 shrink-0" />;
  }

  return (
    <div className="w-16 h-4 flex items-center shrink-0 opacity-60 hover:opacity-100 transition-opacity">
      <svg
        width={64}
        height={16}
        viewBox="0 0 64 16"
        className="overflow-visible"
      >
        <path
          d={pathDef}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
