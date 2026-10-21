import type { Scored } from "@/lib/ml";
import { THRESHOLD } from "@/lib/ml";

/** Last 12 h of SIMULATED readings up to the clock. Flagged readings are marked. */
export default function Sparkline({ data, now }: { data: Scored[]; now: number }) {
  const win = data.filter((r) => r.minute <= now && r.minute > now - 12 * 60);
  if (win.length < 2) return <svg className="spark" />;
  const W = 300, H = 64, lo = 0, hi = 3;
  const x = (i: number) => (i / (win.length - 1)) * W;
  const y = (p: number) => H - ((p - lo) / (hi - lo)) * H;
  const pts = win.map((r, i) => `${x(i).toFixed(1)},${y(r.pressure).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Pressure, last 12 hours (SIMULATED)">
      <line x1="0" x2={W} y1={y(1.5)} y2={y(1.5)} stroke="#e5e9ed" strokeDasharray="3 3" />
      <polyline fill="none" stroke="#0f4c5c" strokeWidth="1.8" points={pts} />
      {win.map((r, i) => (r.score >= THRESHOLD ? <circle key={i} cx={x(i)} cy={y(r.pressure)} r="2.6" fill="#c53030" /> : null))}
    </svg>
  );
}
