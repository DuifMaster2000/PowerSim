// =====================================================================
// Grading tab — log–log time–current characteristic (TCC) chart.
// Plots every relay's IDMT curve and every fuse's (approximate) melting
// band on a shared log–log grid, overlays fault-current markers from the
// last short-circuit run, and tabulates grading margins between relays.
//
// Hand-built SVG (same approach as AnimationPlayer's MismatchChart):
// log10 domain mappers turn current/time into pixel coordinates.
// =====================================================================

import { useStore } from "../store";
import { CURVE_LABELS } from "../defaults";
import { idmtCurvePoints, fuseTccPoints, idmtOperateTime, primaryPickupA } from "../idmt";
import type { RelayParams, FuseParams } from "../types";

// Distinct line colours for relays (cycled). Fuses share a muted amber.
const RELAY_COLORS = ["#4ea1ff", "#38d39f", "#c792ea", "#ff8a65", "#ffd166"];
const FUSE_COLOR = "#e0a030";

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((cell) => `"${cell}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface DeviceCurve {
  id: string;
  label: string;
  color: string;
  dashed: boolean;
  points: { i: number; t: number }[];
}

export function GradingCurves() {
  const components = useStore((s) => s.components);
  const connections = useStore((s) => s.connections);
  const getRelayLinks = useStore((s) => s.getRelayLinks);
  const getRelayFaultCurrents = useStore((s) => s.getRelayFaultCurrents);

  // touch connections so links re-resolve when wiring changes
  void connections;

  const relays = components.filter((c) => c.type === "relay");
  const fuses = components.filter((c) => c.type === "fuse");

  if (relays.length === 0 && fuses.length === 0) {
    return (
      <div className="results-body">
        <div className="props-empty" style={{ padding: 24 }}>
          Add a relay or a fuse to the network, then this tab plots its time–current
          characteristic. Fit a CT to a power wire and pick it as the relay's measured
          CT, then draw a dashed control wire to the breaker, to anchor the relay's
          pickup and fault marker.
        </div>
      </div>
    );
  }

  const faultCurrents = getRelayFaultCurrents();

  // ---- Domain bounds (log decades) ----
  const tMin = 0.01;
  const tMax = 100;

  // Upper current bound: cover fault markers and a generous multiple of pickups.
  let maxI = 1000;
  for (const r of relays) {
    const links = getRelayLinks(r.id);
    const pickup = primaryPickupA(r.parameters as RelayParams, links.ct);
    maxI = Math.max(maxI, pickup * 30);
  }
  for (const f of fuses) maxI = Math.max(maxI, (f.parameters as FuseParams).rated_current_a * 30);
  for (const fc of faultCurrents.values()) maxI = Math.max(maxI, fc.primaryA * 1.3);
  const xMaxDecade = Math.ceil(Math.log10(maxI));
  const xMinDecade = 1; // 10 A
  const iMin = Math.pow(10, xMinDecade);
  const iMax = Math.pow(10, xMaxDecade);

  // ---- Build curves ----
  const curves: DeviceCurve[] = [];
  relays.forEach((r, idx) => {
    const links = getRelayLinks(r.id);
    const pts = idmtCurvePoints(r.parameters as RelayParams, links.ct, iMax, tMax, tMin);
    if (pts.length === 0) return;
    curves.push({
      id: r.id,
      label: `${r.label} · ${CURVE_LABELS[(r.parameters as RelayParams).curve]}`,
      color: RELAY_COLORS[idx % RELAY_COLORS.length],
      dashed: false,
      points: pts,
    });
  });
  fuses.forEach((f) => {
    const pts = fuseTccPoints(f.parameters as FuseParams, iMax, tMax, tMin);
    if (pts.length === 0) return;
    curves.push({
      id: f.id,
      label: `${f.label} · ${(f.parameters as FuseParams).rated_current_a} A fuse (approx.)`,
      color: FUSE_COLOR,
      dashed: true,
      points: pts,
    });
  });

  // ---- SVG geometry ----
  const W = 720;
  const H = 380;
  const padL = 54;
  const padR = 150; // room for legend
  const padT = 14;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const logIMin = Math.log10(iMin);
  const logIMax = Math.log10(iMax);
  const logTMin = Math.log10(tMin);
  const logTMax = Math.log10(tMax);

  const xAt = (i: number) =>
    padL + ((Math.log10(i) - logIMin) / (logIMax - logIMin)) * plotW;
  const yAt = (t: number) =>
    padT + ((logTMax - Math.log10(t)) / (logTMax - logTMin)) * plotH;

  const clampT = (t: number) => Math.min(Math.max(t, tMin), tMax);

  const pathFor = (pts: { i: number; t: number }[]) =>
    pts
      .map((p, k) => `${k === 0 ? "M" : "L"}${xAt(p.i).toFixed(1)},${yAt(clampT(p.t)).toFixed(1)}`)
      .join(" ");

  // Decade gridlines / ticks.
  const xTicks: number[] = [];
  for (let d = xMinDecade; d <= xMaxDecade; d++) xTicks.push(Math.pow(10, d));
  const yTicks: number[] = [];
  for (let d = logTMin; d <= logTMax + 1e-9; d++) yTicks.push(Math.pow(10, d));

  const fmtCurrent = (a: number) => (a >= 1000 ? `${a / 1000} kA` : `${a} A`);
  const fmtTime = (t: number) => (t >= 1 ? `${t}` : `${t}`);

  // ---- Fault markers + operate-time dots ----
  const markers: {
    relayId: string;
    label: string;
    color: string;
    faultA: number;
    operateS: number;
  }[] = [];
  relays.forEach((r, idx) => {
    const fc = faultCurrents.get(r.id);
    if (!fc) return;
    const links = getRelayLinks(r.id);
    const t = idmtOperateTime(r.parameters as RelayParams, links.ct, fc.primaryA);
    markers.push({
      relayId: r.id,
      label: r.label,
      color: RELAY_COLORS[idx % RELAY_COLORS.length],
      faultA: fc.primaryA,
      operateS: t,
    });
  });

  // ---- Grading margins between relay pairs ----
  // Educational approximation: for each pair evaluate both relays' operate
  // times at the higher of their two fault currents (the more downstream fault
  // both devices carry in a radial series). Δt is the coordination margin; the
  // slower device is the upstream backup.
  interface MarginRow {
    upstream: string;
    downstream: string;
    atCurrentA: number;
    deltaT: number;
    tag: "tag-ok" | "tag-warn" | "tag-bad";
  }
  const margins: MarginRow[] = [];
  for (let a = 0; a < relays.length; a++) {
    for (let b = a + 1; b < relays.length; b++) {
      const ra = relays[a];
      const rb = relays[b];
      const fa = faultCurrents.get(ra.id);
      const fb = faultCurrents.get(rb.id);
      if (!fa || !fb) continue;
      const atI = Math.max(fa.primaryA, fb.primaryA);
      const ta = idmtOperateTime(ra.parameters as RelayParams, getRelayLinks(ra.id).ct, atI);
      const tb = idmtOperateTime(rb.parameters as RelayParams, getRelayLinks(rb.id).ct, atI);
      if (!isFinite(ta) && !isFinite(tb)) continue;
      const dt = Math.abs((isFinite(ta) ? ta : tMax) - (isFinite(tb) ? tb : tMax));
      const upstream = ta >= tb ? ra.label : rb.label;
      const downstream = ta >= tb ? rb.label : ra.label;
      const tag = dt < 0.3 ? "tag-bad" : dt < 0.4 ? "tag-warn" : "tag-ok";
      margins.push({ upstream, downstream, atCurrentA: atI, deltaT: dt, tag });
    }
  }

  const exportCsv = () => {
    const rows: string[][] = [["Device", "Current [A]", "Operate time [s]"]];
    for (const c of curves) {
      for (const p of c.points) rows.push([c.label, p.i.toFixed(1), p.t.toFixed(4)]);
    }
    rows.push([]);
    rows.push(["Grading margins"]);
    rows.push(["Upstream", "Downstream", "At current [A]", "Δt [s]"]);
    for (const m of margins) {
      rows.push([m.upstream, m.downstream, m.atCurrentA.toFixed(0), m.deltaT.toFixed(3)]);
    }
    downloadCsv("grading-curves.csv", rows);
  };

  return (
    <>
      <div className="results-header">
        <h3>Protection Grading · Time–Current Curves</h3>
        <div className="results-status">
          <span style={{ color: "var(--text-dim)" }}>
            {relays.length} relay{relays.length !== 1 ? "s" : ""} · {fuses.length} fuse
            {fuses.length !== 1 ? "s" : ""}
            {faultCurrents.size === 0 && " · run a short-circuit for fault markers"}
          </span>
          <button onClick={exportCsv} style={{ fontSize: 11, padding: "1px 8px", marginLeft: 8 }}>
            Export CSV
          </button>
        </div>
      </div>
      <div className="results-body">
        <svg className="tcc-chart" viewBox={`0 0 ${W} ${H}`} width="100%">
          {/* gridlines */}
          {xTicks.map((i) => (
            <line
              key={`xg-${i}`}
              x1={xAt(i)}
              x2={xAt(i)}
              y1={padT}
              y2={padT + plotH}
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}
          {yTicks.map((t) => (
            <line
              key={`yg-${t}`}
              x1={padL}
              x2={padL + plotW}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}

          {/* axis ticks/labels */}
          {xTicks.map((i) => (
            <text
              key={`xt-${i}`}
              x={xAt(i)}
              y={padT + plotH + 18}
              fontSize={10}
              textAnchor="middle"
              fill="var(--text-muted)"
              fontFamily="var(--font-mono)"
            >
              {fmtCurrent(i)}
            </text>
          ))}
          {yTicks.map((t) => (
            <text
              key={`yt-${t}`}
              x={padL - 8}
              y={yAt(t) + 3}
              fontSize={10}
              textAnchor="end"
              fill="var(--text-muted)"
              fontFamily="var(--font-mono)"
            >
              {fmtTime(t)}
            </text>
          ))}
          <text
            x={padL - 40}
            y={padT + plotH / 2}
            fontSize={10}
            textAnchor="middle"
            fill="var(--text-dim)"
            transform={`rotate(-90 ${padL - 40} ${padT + plotH / 2})`}
          >
            Operate time [s]
          </text>
          <text
            x={padL + plotW / 2}
            y={H - 2}
            fontSize={10}
            textAnchor="middle"
            fill="var(--text-dim)"
          >
            Current [A] — primary referred
          </text>

          {/* fault markers (behind curves) */}
          {markers.map((m) => (
            <line
              key={`fm-${m.relayId}`}
              x1={xAt(Math.min(m.faultA, iMax))}
              x2={xAt(Math.min(m.faultA, iMax))}
              y1={padT}
              y2={padT + plotH}
              stroke={m.color}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.5}
            />
          ))}

          {/* device curves */}
          {curves.map((c) => (
            <path
              key={c.id}
              d={pathFor(c.points)}
              fill="none"
              stroke={c.color}
              strokeWidth={1.8}
              strokeDasharray={c.dashed ? "6 4" : undefined}
            />
          ))}

          {/* operate-time dots */}
          {markers.map((m) =>
            isFinite(m.operateS) ? (
              <circle
                key={`dot-${m.relayId}`}
                cx={xAt(Math.min(m.faultA, iMax))}
                cy={yAt(clampT(m.operateS))}
                r={3.5}
                fill={m.color}
                stroke="var(--panel)"
                strokeWidth={1}
              />
            ) : null,
          )}

          {/* legend */}
          {curves.map((c, k) => (
            <g key={`lg-${c.id}`} transform={`translate(${padL + plotW + 14}, ${padT + 6 + k * 18})`}>
              <line
                x1={0}
                x2={18}
                y1={0}
                y2={0}
                stroke={c.color}
                strokeWidth={2}
                strokeDasharray={c.dashed ? "5 3" : undefined}
              />
              <text x={24} y={3} fontSize={10} fill="var(--text)" fontFamily="var(--font-mono)">
                {c.label.length > 22 ? c.label.slice(0, 21) + "…" : c.label}
              </text>
            </g>
          ))}
        </svg>

        {markers.length > 0 && (
          <table className="results-table" style={{ marginTop: 4 }}>
            <thead>
              <tr>
                <th>Relay</th>
                <th>Fault current [A]</th>
                <th>Operate time [s]</th>
              </tr>
            </thead>
            <tbody>
              {markers.map((m) => (
                <tr key={`mr-${m.relayId}`}>
                  <td>{m.label}</td>
                  <td>{m.faultA.toFixed(0)}</td>
                  <td>{isFinite(m.operateS) ? m.operateS.toFixed(3) : "no trip (below pickup)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {margins.length > 0 && (
          <table className="results-table" style={{ marginTop: 4 }}>
            <thead>
              <tr>
                <th>Upstream (backup)</th>
                <th>Downstream</th>
                <th>At current [A]</th>
                <th>Margin Δt [s]</th>
              </tr>
            </thead>
            <tbody>
              {margins.map((m, k) => (
                <tr key={`mg-${k}`}>
                  <td>{m.upstream}</td>
                  <td>{m.downstream}</td>
                  <td>{m.atCurrentA.toFixed(0)}</td>
                  <td className={m.tag}>{m.deltaT.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
