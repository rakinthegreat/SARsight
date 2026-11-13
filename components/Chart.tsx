// Minimal SVG line/area chart for time series and transects.
export interface Line { values: number[]; color: string; area?: boolean; dashed?: boolean }

export default function Chart({ lines, marker, xLabels, yUnit, height = 132, independent = false }: {
  lines: Line[];
  marker?: number;
  xLabels?: [string, string];
  yUnit?: string;
  height?: number;
  independent?: boolean; // scale every line to its own range (first line owns the axis labels)
}) {
  const W = 320, H = height, pad = { l: 34, r: 8, t: 10, b: xLabels ? 20 : 8 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const ext = (v: number[]) => {
    const f = v.filter(Number.isFinite);
    let lo = Math.min(...f), hi = Math.max(...f);
    if (!f.length) return [0, 1];
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const p = (hi - lo) * 0.08;
    return [lo >= 0 ? Math.max(0, lo - p) : lo - p, hi + p]; // non-negative data (rain, %) never shows a negative axis
  };
  const all = lines.flatMap((l) => l.values);
  const shared = ext(all);
  const n = Math.max(...lines.map((l) => l.values.length));
  const X = (i: number) => pad.l + (i / Math.max(1, n - 1)) * iw;
  const paths = lines.map((l) => {
    const [lo, hi] = independent ? ext(l.values) : shared;
    const Y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
    let d = "";
    l.values.forEach((v, i) => { if (Number.isFinite(v)) d += `${d && !Number.isNaN(l.values[i - 1]) ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; });
    const area = l.area && d ? `${d}L${X(n - 1)},${pad.t + ih}L${X(0)},${pad.t + ih}Z` : "";
    return { d, area, l, Y };
  });
  const [lo, hi] = independent ? ext(lines[0].values) : shared;
  const fmt = (v: number) => (Math.abs(hi - lo) < 3 ? v.toFixed(1) : Math.round(v).toString());
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      {[0, 0.5, 1].map((q) => {
        const y = pad.t + ih * q;
        return (
          <g key={q}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} className="grid" />
            <text x={pad.l - 6} y={y} className="tick" textAnchor="end" dominantBaseline="central">{fmt(hi - (hi - lo) * q)}</text>
          </g>
        );
      })}
      {yUnit && <text x={pad.l - 6} y={H - 4} className="tick" textAnchor="end">{yUnit}</text>}
      {paths.map(({ d, area, l }, i) => (
        <g key={i}>
          {area && <path d={area} fill={l.color} opacity={0.18} />}
          <path d={d} fill="none" stroke={l.color} strokeWidth={2} strokeDasharray={l.dashed ? "4 4" : undefined} strokeLinejoin="round" />
        </g>
      ))}
      {marker !== undefined && (
        <g>
          <line x1={X(marker)} x2={X(marker)} y1={pad.t} y2={pad.t + ih} className="cursor" />
          {paths.map(({ l, Y }, i) => Number.isFinite(l.values[marker]) && !l.area && <circle key={i} cx={X(marker)} cy={Y(l.values[marker])} r={4} fill={l.color} />)}
        </g>
      )}
      {xLabels && (
        <>
          <text x={pad.l} y={H - 4} className="tick">{xLabels[0]}</text>
          <text x={W - pad.r} y={H - 4} className="tick" textAnchor="end">{xLabels[1]}</text>
        </>
      )}
    </svg>
  );
}
