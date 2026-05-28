export type StackedAreaSeries = {
  label: string;
  color: string;
  values: number[];
};

type StackedAreaChartProps = {
  series: StackedAreaSeries[];
  labels?: string[];
  height?: number;
  className?: string;
};

function formatTick(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return Math.round(v).toString();
}

export function StackedAreaChart({
  series,
  labels,
  height = 220,
  className,
}: StackedAreaChartProps) {
  const width = 720;
  const padX = 44;
  const padY = 20;

  const length = series[0]?.values.length ?? 0;

  if (length === 0 || series.length === 0) {
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

  const cumulative: number[][] = [];
  let running = new Array(length).fill(0);
  for (const s of series) {
    const next = running.map((acc, i) => acc + (Number.isFinite(s.values[i]) ? s.values[i] : 0));
    cumulative.push(next);
    running = next;
  }
  const max = Math.max(1, ...running);

  const innerWidth = width - padX * 2;
  const stepX = length > 1 ? innerWidth / (length - 1) : 0;
  const xAt = (i: number) => (length === 1 ? padX + innerWidth / 2 : padX + i * stepX);
  const yAt = (v: number) => padY + (1 - v / max) * (height - padY * 2);

  const yTicks = 4;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => {
    const value = (max * i) / yTicks;
    const y = padY + (1 - i / yTicks) * (height - padY * 2);
    return { value, y };
  });

  const paths = series.map((s, sIdx) => {
    const upper = cumulative[sIdx];
    const lower = sIdx === 0 ? new Array(length).fill(0) : cumulative[sIdx - 1];

    const upperPts = upper.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`);
    const lowerPts = lower
      .map((v, i) => `L${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`)
      .reverse();

    return {
      label: s.label,
      color: s.color,
      d: `${upperPts.join(" ")} ${lowerPts.join(" ")} Z`,
      linePath: upperPts.join(" "),
    };
  });

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={padX}
              x2={width - padX}
              y1={t.y}
              y2={t.y}
              className="stroke-zinc-200"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <text
              x={padX - 6}
              y={t.y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-zinc-500 text-[10px] tabular-nums"
            >
              {formatTick(t.value)}
            </text>
          </g>
        ))}

        {paths.map((p) => (
          <g key={p.label}>
            <path d={p.d} fill={p.color} fillOpacity={0.25} />
            <path
              d={p.linePath}
              fill="none"
              stroke={p.color}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ))}

        {labels?.map((label, i) => {
          const labelX =
            labels.length === 1
              ? padX + innerWidth / 2
              : padX + i * (innerWidth / Math.max(1, labels.length - 1));
          return (
            <text
              key={i}
              x={labelX}
              y={height - 4}
              textAnchor="middle"
              className="fill-zinc-500 text-[10px]"
            >
              {label}
            </text>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-3 px-2 text-[11px] text-zinc-600">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
