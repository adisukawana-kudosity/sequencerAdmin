type DonutSegment = {
  label: string;
  value: number;
  color: string;
};

type DonutChartProps = {
  data: DonutSegment[];
  size?: number;
  thickness?: number;
};

export function DonutChart({ data, size = 180, thickness = 22 }: DonutChartProps) {
  const safeData = (data ?? []).filter((s) => Number.isFinite(s.value) && s.value >= 0);
  const total = safeData.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  let offset = 0;

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          className="stroke-zinc-100"
        />
        {total > 0 &&
          safeData.map((s) => {
            const frac = s.value / total;
            const dash = frac * circumference;
            const el = (
              <circle
                key={s.label}
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                strokeWidth={thickness}
                stroke={s.color}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return el;
          })}
      </svg>

      <ul className="flex flex-col gap-2.5 text-sm">
        {safeData.map((s) => {
          const pct = total > 0 ? ((s.value / total) * 100).toFixed(1) : "0.0";
          return (
            <li key={s.label} className="flex items-center gap-3">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: s.color }}
              />
              <span className="text-zinc-700">{s.label}</span>
              <span className="ml-auto tabular-nums text-zinc-500">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
