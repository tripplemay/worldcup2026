'use client';

/**
 * 通用雷达图(纯 SVG,无依赖)。各轴 value 为 0–100;available=false 的轴淡显。
 * 用于球队页「实力档案」。
 */
export interface RadarDatum {
  label: string;
  value: number; // 0–100
  available: boolean;
}

const RINGS = [0.25, 0.5, 0.75, 1];

export default function RadarChart({
  data,
  size = 230,
}: {
  data: RadarDatum[];
  size?: number;
}) {
  const n = data.length;
  if (n < 3) return null;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 38; // 留出标签空间
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, r: number): [number, number] => [
    cx + r * Math.cos(angle(i)),
    cy + r * Math.sin(angle(i)),
  ];
  const poly = (r: (i: number) => number) =>
    data.map((_, i) => pt(i, r(i)).join(',')).join(' ');

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto h-auto w-full max-w-[300px]"
      role="img"
    >
      {/* 同心网格 */}
      {RINGS.map((f) => (
        <polygon
          key={f}
          points={poly(() => R * f)}
          className="fill-none stroke-gray-200 dark:stroke-navy-700"
          strokeWidth={1}
        />
      ))}
      {/* 辐条 + 顶点标签 */}
      {data.map((d, i) => {
        const [x, y] = pt(i, R);
        const [lx, ly] = pt(i, R + 16);
        const anchor =
          Math.abs(lx - cx) < 4 ? 'middle' : lx > cx ? 'start' : 'end';
        return (
          <g key={d.label}>
            <line
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              className="stroke-gray-200 dark:stroke-navy-700"
              strokeWidth={1}
            />
            <text
              x={lx}
              y={ly}
              textAnchor={anchor}
              dominantBaseline="middle"
              className="fill-gray-500 text-[10px] font-medium dark:fill-gray-400"
            >
              {d.label}
            </text>
            <text
              x={lx}
              y={ly + 11}
              textAnchor={anchor}
              dominantBaseline="middle"
              className={`text-[9px] font-bold tabular-nums ${
                d.available ? 'fill-brand-500 dark:fill-brand-400' : 'fill-gray-400'
              }`}
            >
              {d.available ? Math.round(d.value) : '—'}
            </text>
          </g>
        );
      })}
      {/* 数据多边形 */}
      <polygon
        points={poly((i) => R * (data[i].value / 100))}
        className="fill-brand-500/20 stroke-brand-500 dark:fill-brand-400/20 dark:stroke-brand-400"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {data.map((d, i) => {
        const [x, y] = pt(i, R * (d.value / 100));
        return (
          <circle
            key={`dot${i}`}
            cx={x}
            cy={y}
            r={2.5}
            className="fill-brand-500 dark:fill-brand-400"
          />
        );
      })}
    </svg>
  );
}
