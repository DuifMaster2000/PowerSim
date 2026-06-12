// =====================================================================
// Grading tab — log–log time–current characteristic (TCC) chart.
//
// Two modes:
//  - No grading selection: plots every relay + fuse (quick overview).
//  - Grading selection (components clicked on the canvas while this tab
//    is open): plots exactly the selected section's curves — relays
//    (directly or via the breaker they trip), fuses, motor start curves,
//    cable thermal damage curves, transformer damage curves + inrush.
// Curve colours match the dots shown on the selected canvas components.
//
// Hand-built SVG (same approach as AnimationPlayer's MismatchChart):
// log10 domain mappers turn current/time into pixel coordinates.
// =====================================================================

import { useStore } from "../store";
import { CURVE_LABELS, GRADING_COLORS } from "../defaults";
import {
  idmtCurvePoints,
  fuseTccPoints,
  idmtOperateTime,
  primaryPickupA,
  relayHighestPickupA,
  motorStartCurvePoints,
  cableDamageCurvePoints,
  transformerDamageCurvePoints,
  transformerInrushPoint,
  CABLE_K_CU_XLPE,
} from "../idmt";
import type { RelayParams, FuseParams, CableParams, TransformerParams, PowerComponent } from "../types";

const FUSE_COLOR = "#e0a030";

// Dash patterns distinguish curve kinds even when colours repeat.
const DASH: Record<string, string | undefined> = {
  relay: undefined,
  fuse: "6 4",
  motor: "2 3",
  cable: "10 4",
  transformer: "1 3",
};

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
  dash?: string;
  points: { i: number; t: number }[];
}

interface DotMarker {
  id: string;
  i: number;
  t: number;
  color: string;
  label: string;
}

// A device contributing curves to the study, resolved from the selection.
interface Entry {
  device: PowerComponent; // the curve's own device (relay, fuse, motor, cable, transformer)
  kind: "relay" | "fuse" | "motor" | "cable" | "transformer";
  color: string;
  via?: string; // breaker label when a relay entered via its breaker
}

export function GradingCurves() {
  const components = useStore((s) => s.components);
  const connections = useStore((s) => s.connections);
  const getRelayLinks = useStore((s) => s.getRelayLinks);
  const getRelayFaultCurrents = useStore((s) => s.getRelayFaultCurrents);
  const getMotorGradingData = useStore((s) => s.getMotorGradingData);
  const getBusFaultLevels = useStore((s) => s.getBusFaultLevels);
  const gradingSelection = useStore((s) => s.gradingSelection);
  const toggleGradingComponent = useStore((s) => s.toggleGradingComponent);
  const clearGradingSelection = useStore((s) => s.clearGradingSelection);

  // touch connections so links re-resolve when wiring changes
  void connections;

  const byId = new Map(components.map((c) => [c.id, c]));
  const selection = gradingSelection.filter((id) => byId.has(id));
  const selectionMode = selection.length > 0;

  const allRelays = components.filter((c) => c.type === "relay");
  const allFuses = components.filter((c) => c.type === "fuse");

  if (!selectionMode && allRelays.length === 0 && allFuses.length === 0) {
    return (
      <div className="results-body">
        <div className="props-empty" style={{ padding: 24 }}>
          Add a relay or a fuse to the network, then this tab plots its time–current
          characteristic. With this tab open, click breakers, fuses, motors, cables or
          transformers on the canvas to grade a specific section.
        </div>
      </div>
    );
  }

  // ---- Resolve the selection into curve entries ----
  const entries: Entry[] = [];
  const skipped: string[] = [];
  if (selectionMode) {
    const seenRelays = new Set<string>();
    selection.forEach((id, idx) => {
      const comp = byId.get(id)!;
      const color = GRADING_COLORS[idx % GRADING_COLORS.length];
      if (comp.type === "relay") {
        if (!seenRelays.has(comp.id)) {
          seenRelays.add(comp.id);
          entries.push({ device: comp, kind: "relay", color });
        }
      } else if (comp.type === "switch") {
        const linked = allRelays.filter((r) => getRelayLinks(r.id).breakerId === comp.id);
        if (linked.length === 0) {
          skipped.push(`${comp.label}: no relay trips this breaker — wire a relay's control wire to it.`);
        }
        for (const r of linked) {
          if (seenRelays.has(r.id)) continue;
          seenRelays.add(r.id);
          entries.push({ device: r, kind: "relay", color, via: comp.label });
        }
      } else if (comp.type === "fuse") {
        entries.push({ device: comp, kind: "fuse", color });
      } else if (comp.type === "motor") {
        entries.push({ device: comp, kind: "motor", color });
      } else if (comp.type === "cable") {
        entries.push({ device: comp, kind: "cable", color });
      } else if (comp.type === "transformer") {
        entries.push({ device: comp, kind: "transformer", color });
      }
    });
  } else {
    allRelays.forEach((r, idx) =>
      entries.push({ device: r, kind: "relay", color: GRADING_COLORS[idx % GRADING_COLORS.length] }),
    );
    allFuses.forEach((f) => entries.push({ device: f, kind: "fuse", color: FUSE_COLOR }));
  }

  const relayEntries = entries.filter((e) => e.kind === "relay");
  const faultCurrents = getRelayFaultCurrents();
  const motorData = getMotorGradingData();

  // Selected busbars contribute a vertical fault-level line (not a curve),
  // coloured by their position in the selection (matches the canvas dot).
  const busFaults = selectionMode ? getBusFaultLevels() : new Map<string, { faultA: number; label: string }>();
  const busLines: { id: string; label: string; faultA: number; color: string }[] = [];
  if (selectionMode) {
    selection.forEach((id, idx) => {
      const comp = byId.get(id)!;
      if (comp.type !== "busbar") return;
      const bf = busFaults.get(id);
      if (bf) {
        busLines.push({ id, label: bf.label, faultA: bf.faultA, color: GRADING_COLORS[idx % GRADING_COLORS.length] });
      } else {
        skipped.push(`${comp.label}: couldn't compute a fault level — needs a grid source and a solvable path.`);
      }
    });
  }

  // ---- Domain bounds (log decades) ----
  const tMin = 0.01;
  const tMax = 100;

  let maxI = 1000;
  for (const e of entries) {
    if (e.kind === "relay") {
      const links = getRelayLinks(e.device.id);
      const pickup = primaryPickupA(e.device.parameters as RelayParams, links.ct);
      const highest = relayHighestPickupA(e.device.parameters as RelayParams, links.ct);
      maxI = Math.max(maxI, pickup * 30, highest * 2);
    } else if (e.kind === "fuse") {
      maxI = Math.max(maxI, (e.device.parameters as FuseParams).rated_current_a * 30);
    } else if (e.kind === "motor") {
      const md = motorData.get(e.device.id);
      if (md) maxI = Math.max(maxI, md.startA * 2);
    } else if (e.kind === "cable") {
      const csa = (e.device.parameters as CableParams).csa_mm2 ?? 120;
      // Cover the damage current at 1 s so a useful stretch of the curve shows.
      maxI = Math.max(maxI, CABLE_K_CU_XLPE * csa * 1.2);
    } else if (e.kind === "transformer") {
      const p = e.device.parameters as TransformerParams;
      const inA = (p.rated_mva * 1000) / (Math.sqrt(3) * p.primary_kv);
      maxI = Math.max(maxI, inA * 27.5);
    }
  }
  for (const fc of faultCurrents.values()) maxI = Math.max(maxI, fc.primaryA * 1.3);
  for (const b of busLines) maxI = Math.max(maxI, b.faultA * 1.3);
  const xMaxDecade = Math.ceil(Math.log10(maxI));
  const xMinDecade = 1; // 10 A
  const iMin = Math.pow(10, xMinDecade);
  const iMax = Math.pow(10, xMaxDecade);

  // ---- Build curves ----
  const curves: DeviceCurve[] = [];
  const dots: DotMarker[] = [];
  for (const e of entries) {
    const c = e.device;
    if (e.kind === "relay") {
      const links = getRelayLinks(c.id);
      const rp = c.parameters as RelayParams;
      const pts = idmtCurvePoints(rp, links.ct, iMax, tMax, tMin);
      if (pts.length === 0) continue;
      const stageCount = 1 + ((rp.stage2_enabled ?? false) ? 1 : 0) + ((rp.stage3_enabled ?? false) ? 1 : 0);
      curves.push({
        id: c.id,
        label: `${c.label}${e.via ? ` (${e.via})` : ""} · ${stageCount > 1 ? `${stageCount}-stage ` : ""}${CURVE_LABELS[rp.curve]}`,
        color: e.color,
        dash: DASH.relay,
        points: pts,
      });
    } else if (e.kind === "fuse") {
      const pts = fuseTccPoints(c.parameters as FuseParams, iMax, tMax, tMin);
      if (pts.length === 0) continue;
      curves.push({
        id: c.id,
        label: `${c.label} · ${(c.parameters as FuseParams).rated_current_a} A fuse (approx.)`,
        color: e.color,
        dash: DASH.fuse,
        points: pts,
      });
    } else if (e.kind === "motor") {
      const md = motorData.get(c.id);
      if (!md) {
        skipped.push(`${c.label}: not connected to an energised bus — wire it up to compute its FLC.`);
        continue;
      }
      const pts = motorStartCurvePoints(md.flcA, md.startA, md.startTimeS, tMax, tMin);
      if (pts.length === 0) continue;
      curves.push({
        id: c.id,
        label: `${c.label} · start ${(md.startA / md.flcA).toFixed(1)}×FLC · ${md.startTimeS}s`,
        color: e.color,
        dash: DASH.motor,
        points: pts,
      });
    } else if (e.kind === "cable") {
      const csa = (c.parameters as CableParams).csa_mm2 ?? 120;
      const pts = cableDamageCurvePoints(csa, iMax, tMax, tMin);
      if (pts.length === 0) continue;
      curves.push({
        id: c.id,
        label: `${c.label} · ${csa} mm² damage`,
        color: e.color,
        dash: DASH.cable,
        points: pts,
      });
    } else if (e.kind === "transformer") {
      const p = c.parameters as TransformerParams;
      const inA = (p.rated_mva * 1000) / (Math.sqrt(3) * p.primary_kv);
      const pts = transformerDamageCurvePoints(inA, tMax, tMin);
      if (pts.length === 0) continue;
      curves.push({
        id: c.id,
        label: `${c.label} · damage (cat. I)`,
        color: e.color,
        dash: DASH.transformer,
        points: pts,
      });
      const inrush = transformerInrushPoint(inA);
      dots.push({
        id: `inrush-${c.id}`,
        i: inrush.i,
        t: inrush.t,
        color: e.color,
        label: `${c.label} inrush ~12×In`,
      });
    }
  }

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

  // ---- Fault markers + operate-time dots (displayed relays only) ----
  const markers: {
    relayId: string;
    label: string;
    color: string;
    faultA: number;
    operateS: number;
  }[] = [];
  relayEntries.forEach((e) => {
    const fc = faultCurrents.get(e.device.id);
    if (!fc) return;
    const links = getRelayLinks(e.device.id);
    const t = idmtOperateTime(e.device.parameters as RelayParams, links.ct, fc.primaryA);
    markers.push({
      relayId: e.device.id,
      label: e.device.label,
      color: e.color,
      faultA: fc.primaryA,
      operateS: t,
    });
  });

  // ---- Grading margins between displayed relay pairs ----
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
  for (let a = 0; a < relayEntries.length; a++) {
    for (let b = a + 1; b < relayEntries.length; b++) {
      const ra = relayEntries[a].device;
      const rb = relayEntries[b].device;
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
    const rows: string[][] = [["Device", "Current [A]", "Operate/withstand time [s]"]];
    for (const c of curves) {
      for (const p of c.points) rows.push([c.label, p.i.toFixed(1), p.t.toFixed(4)]);
    }
    if (busLines.length > 0) {
      rows.push([]);
      rows.push(["Bus fault levels"]);
      rows.push(["Bus", "Ik\" [kA]"]);
      for (const b of busLines) rows.push([b.label, (b.faultA / 1000).toFixed(3)]);
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
            {selectionMode
              ? `${selection.length} component${selection.length !== 1 ? "s" : ""} in study · click canvas components to add/remove`
              : `showing all relays & fuses · click a breaker, motor, fuse, cable or transformer on the canvas to grade a section`}
            {faultCurrents.size === 0 && " · run a short-circuit for fault markers"}
          </span>
          <button onClick={exportCsv} style={{ fontSize: 11, padding: "1px 8px", marginLeft: 8 }}>
            Export CSV
          </button>
        </div>
      </div>
      <div className="results-body">
        {selectionMode && (
          <div className="grading-chips">
            {selection.map((id, idx) => {
              const color = GRADING_COLORS[idx % GRADING_COLORS.length];
              return (
                <span key={id} className="grading-chip" style={{ borderColor: color, color }}>
                  {byId.get(id)!.label}
                  <button
                    title="Remove from grading study"
                    onClick={() => toggleGradingComponent(id)}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            <button className="grading-clear" onClick={clearGradingSelection}>
              Clear all
            </button>
          </div>
        )}

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
            Current [A] — at each device's own voltage level
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

          {/* bus fault-level lines (behind curves, with a kA label at top) */}
          {busLines.map((b) =>
            b.faultA <= iMax ? (
              <g key={`bus-${b.id}`}>
                <line
                  x1={xAt(b.faultA)}
                  x2={xAt(b.faultA)}
                  y1={padT}
                  y2={padT + plotH}
                  stroke={b.color}
                  strokeWidth={1.6}
                  opacity={0.9}
                />
                <text
                  x={xAt(b.faultA)}
                  y={padT + 9}
                  fontSize={9}
                  textAnchor="middle"
                  fill={b.color}
                  fontFamily="var(--font-mono)"
                >
                  {b.label} {(b.faultA / 1000).toFixed(1)}kA
                </text>
              </g>
            ) : null,
          )}

          {/* device curves */}
          {curves.map((c) => (
            <path
              key={c.id}
              d={pathFor(c.points)}
              fill="none"
              stroke={c.color}
              strokeWidth={1.8}
              strokeDasharray={c.dash}
            />
          ))}

          {/* transformer inrush points */}
          {dots.map((d) =>
            d.i <= iMax ? (
              <g key={d.id}>
                <circle
                  cx={xAt(d.i)}
                  cy={yAt(clampT(d.t))}
                  r={4}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={1.6}
                />
                <circle cx={xAt(d.i)} cy={yAt(clampT(d.t))} r={1.4} fill={d.color} />
                <title>{d.label}</title>
              </g>
            ) : null,
          )}

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
                strokeDasharray={c.dash ? "5 3" : undefined}
              />
              <text x={24} y={3} fontSize={10} fill="var(--text)" fontFamily="var(--font-mono)">
                {c.label.length > 22 ? c.label.slice(0, 21) + "…" : c.label}
              </text>
            </g>
          ))}
        </svg>

        {skipped.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--warn)", padding: "2px 4px", lineHeight: 1.5 }}>
            {skipped.map((s, k) => (
              <div key={k}>⚠ {s}</div>
            ))}
          </div>
        )}

        {busLines.length > 0 && (
          <table className="results-table" style={{ marginTop: 4 }}>
            <thead>
              <tr>
                <th>Bus</th>
                <th>Fault level Ik″ [kA]</th>
              </tr>
            </thead>
            <tbody>
              {busLines.map((b) => (
                <tr key={`bf-${b.id}`}>
                  <td style={{ color: b.color }}>{b.label}</td>
                  <td>{(b.faultA / 1000).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

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
