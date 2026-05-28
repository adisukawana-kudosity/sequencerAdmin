type AreaChartProps = {
  data: number[];
  labels?: string[];
  height?: number;
  className?: string;
};

export function AreaChart({ data, labels, height = 220, className }: AreaChartProps) {
  const width = 720;
  const padX = 32;
  const padY = 20;

  const safeData = (data ?? []).filter((v): v is number => Number.isFinite(v));

  if (safeData.length === 0) {
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

  const max = Math.max(...safeData);
  const min = Math.min(...safeData);
  const range = max - min > 0 ? max - min : 1;

  const innerWidth = width - padX * 2;
  const stepX = safeData.length > 1 ? innerWidth / (safeData.length - 1) : 0;

  const points = safeData.map((v, i) => {
    const x = safeData.length === 1 ? padX + innerWidth / 2 : padX + i * stepX;
    const y = padY + (1 - (v - min) / range) * (height - padY * 2);
    return [x, y] as const;
  });

  const linePath = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");

  const first = points[0];
  const last = points[points.length - 1];
  const areaPath = `${linePath} L${last[0]},${height - padY} L${first[0]},${height - padY} Z`;

  const yTicks = 4;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => {
    const value = min + (range * i) / yTicks;
    const y = padY + (1 - i / yTicks) * (height - padY * 2);
    return { value, y };
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
    >
      <defs>
        <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      {ticks.map((t, i) => (
        <line
          key={i}
          x1={padX}
          x2={width - padX}
          y1={t.y}
          y2={t.y}
          className="stroke-zinc-200"
          strokeDasharray="3 3"
          strokeWidth="1"
        />
      ))}

      <path d={areaPath} fill="url(#area-grad)" className="text-violet-500" />
      <path
        d={linePath}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-violet-500"
      />

      {points.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r="2.5"
          className="fill-white stroke-violet-500"
          strokeWidth="1.5"
        />
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
  );
}
