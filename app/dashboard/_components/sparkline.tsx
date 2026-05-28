type SparklineProps = {
  data: number[];
  trend?: "up" | "down";
  width?: number;
  height?: number;
};

export function Sparkline({ data, trend = "up", width = 96, height = 32 }: SparklineProps) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);

  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = (1 - (v - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const colorClass = trend === "up" ? "stroke-emerald-500" : "stroke-rose-500";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={colorClass}
      />
    </svg>
  );
}
