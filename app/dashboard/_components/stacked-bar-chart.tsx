export type StackedBarSegment = {
  label: string;
  value: number;
  color: string;
};

export type StackedBarDatum = {
  label: string;
  segments: StackedBarSegment[];
};

type StackedBarChartProps = {
  data: StackedBarDatum[];
  height?: number;
  className?: string;
};

function formatTick(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return Math.round(v).toString();
}

export function StackedBarChart({ data, height = 220, className }: StackedBarChartProps) {
  const width = 720;
  const padX = 44;
  const padY = 24;

  if (data.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={className}
        role="img"
      >
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          className="fill-zinc-400 text-xs"
        >
          No data
        </text>
      </svg>
    );
  }

  const totals = data.map((d) => d.segments.reduce((s, seg) => s + seg.value, 0));
  const max = Math.max(1, ...totals);

  const slot = (width - padX * 2) / data.length;
  const barWidth = Math.min(slot * 0.6, 36);
  const innerH = height - padY * 2;

  const legend = data[0]?.segments.map((s) => ({ label: s.label, color: s.color })) ?? [];

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
          const y = padY + (1 - t) * innerH;
          return (
            <g key={i}>
              <line
                x1={padX}
                x2={width - padX}
                y1={y}
                y2={y}
                className="stroke-zinc-200"
                strokeDasharray="3 3"
              />
              <text
                x={padX - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-zinc-500 text-[10px] tabular-nums"
              >
                {formatTick(max * t)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const baseX = padX + i * slot + slot / 2 - barWidth / 2;
          let cursor = height - padY;
          return (
            <g key={`${d.label}-${i}`}>
              {d.segments.map((seg) => {
                const h = (seg.value / max) * innerH;
                cursor -= h;
                return (
                  <rect
                    key={seg.label}
                    x={baseX}
                    y={cursor}
                    width={barWidth}
                    height={h}
                    fill={seg.color}
                  >
                    <title>{`${d.label} · ${seg.label}: ${seg.value}`}</title>
                  </rect>
                );
              })}
              <text
                x={baseX + barWidth / 2}
                y={height - 6}
                textAnchor="middle"
                className="fill-zinc-500 text-[10px]"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-3 px-2 text-[11px] text-zinc-600">
        {legend.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
