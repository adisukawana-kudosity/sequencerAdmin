type BarChartProps = {
  data: { label: string; value: number }[];
  height?: number;
  className?: string;
};

export function BarChart({ data, height = 220, className }: BarChartProps) {
  const width = 720;
  const padX = 32;
  const padY = 24;

  const max = Math.max(...data.map((d) => d.value));
  const slot = (width - padX * 2) / data.length;
  const barWidth = Math.min(slot * 0.55, 28);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
        const y = padY + (1 - t) * (height - padY * 2);
        return (
          <line
            key={i}
            x1={padX}
            x2={width - padX}
            y1={y}
            y2={y}
            className="stroke-zinc-200"
            strokeDasharray="3 3"
          />
        );
      })}

      {data.map((d, i) => {
        const h = (d.value / max) * (height - padY * 2);
        const x = padX + i * slot + slot / 2 - barWidth / 2;
        const y = height - padY - h;
        return (
          <g key={d.label}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={h}
              rx="3"
              className="fill-zinc-900"
            />
            <text
              x={x + barWidth / 2}
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
  );
}
