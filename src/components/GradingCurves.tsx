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
  thermalCurvePoints,
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
  thermal: "6 2 1 2",
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
  points: { i: number; t: number }[]; // actual amps at the device's own voltage
  factor: number; // ×current to refer onto the chart's reference voltage (1 = no referral)
}

interface DotMarker {
  id: string;
  i: number;
  t: number;
  color: string;
  label: string;
  factor: number;
}

// A device contributing curves to the study, resolved from the selection.
interface Entry {
  device: PowerComponent; // the curve's own device (relay, fuse, motor, cable, transformer)
  kind: "relay" | "fuse" | "motor" | "cable" | "transformer";
  color: string;
  kv?: number; // the device's voltage level (for referral); undefined if unknown
  via?: string; // breaker label when a relay entered via its breaker
}

export function GradingCurves() {
  const components = useStore((s) => s.components);
  const connections = useStore((s) => s.connections);
  const getRelayLinks = useStore((s) => s.getRelayLinks);
  const getRelayFaultCurrents = useStore((s) => s.getRelayFaultCurrents);
  const getMotorGradingData = useStore((s) => s.getMotorGradingData);
  const getBusFaultLevels = useStore((s) => s.getBusFaultLevels);
  const getComponentKv = useStore((s) => s.getComponentKv);
  const gradingSelection = useStore((s) => s.gradingSelection);
  const gradingRefKv = useStore((s) => s.gradingRefKv);
  const setGradingRefKv = useStore((s) => s.setGradingRefKv);
  const toggleGradingComponent = useStore((s) => s.toggleGradingComponent);
  const clearGradingSelection = useStore((s) => s.clearGradingSelection);

  // touch connections so links re-resolve when wiring changes
  void connections;

  // Per-component voltage level + referral factor onto the chosen reference kV.
  const compKv = getComponentKv();
  const refKv = gradingRefKv;
  const factorFor = (kv: number | undefined): number =>
    refKv && kv && kv > 0 ? kv / refKv : 1;
  const kvLevels = Array.from(new Set(Array.from(compKv.values()).filter((v) => v > 0))).sort((a, b) => b - a);
  const fmtKv = (kv: number) => `${+kv.toFixed(3)} kV`;

  // A relay has no power bus of its own — its current is referred at the
  // voltage of the breaker it trips (or, failing that, the CT's conductor).
  const relayKv = (relayId: string): number | undefined => {
    const links = getRelayLinks(relayId);
    if (links.breakerId && compKv.has(links.breakerId)) return compKv.get(links.breakerId);
    if (links.ctConnectionId) {
      const conn = connections.find((c) => c.id === links.ctConnectionId);
      if (conn) return compKv.get(conn.fromComponent) ?? compKv.get(conn.toComponent);
    }
    return undefined;
  };

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
          entries.push({ device: comp, kind: "relay", color, kv: relayKv(comp.id) });
        }
      } else if (comp.type === "switch") {
        const linked = allRelays.filter((r) => getRelayLinks(r.id).breakerId === comp.id);
        if (linked.length === 0) {
          skipped.push(`${comp.label}: no relay trips this breaker — wire a relay's control wire to it.`);
        }
        for (const r of linked) {
          if (seenRelays.has(r.id)) continue;
          seenRelays.add(r.id);
          entries.push({ device: r, kind: "relay", color, via: comp.label, kv: relayKv(r.id) });
        }
      } else if (comp.type === "fuse") {
        entries.push({ device: comp, kind: "fuse", color, kv: compKv.get(comp.id) });
      } else if (comp.type === "motor") {
        entries.push({ device: comp, kind: "motor", color, kv: compKv.get(comp.id) });
      } else if (comp.type === "cable") {
        entries.push({ device: comp, kind: "cable", color, kv: compKv.get(comp.id) });
      } else if (comp.type === "transformer") {
        entries.push({ device: comp, kind: "transformer", color, kv: compKv.get(comp.id) });
      }
    });
  } else {
    allRelays.forEach((r, idx) =>
      entries.push({ device: r, kind: "relay", color: GRADING_COLORS[idx % GRADING_COLORS.length], kv: relayKv(r.id) }),
    );
    allFuses.forEach((f) => entries.push({ device: f, kind: "fuse", color: FUSE_COLOR, kv: compKv.get(f.id) }));
  }

  // If a reference voltage is set, note any device whose level we can't resolve.
  if (refKv) {
    for (const e of entries) {
      if (e.kv === undefined) {
        skipped.push(`${e.device.label}: voltage level unknown — plotted at its own current (not referred).`);
      }
    }
  }

  const relayEntries = entries.filter((e) => e.kind === "relay");
  const faultCurrents = getRelayFaultCurrents();
  const motorData = getMotorGradingData();

  // Selected busbars contribute a vertical fault-level line (not a curve),
  // coloured by their position in the selection (matches the canvas dot).
  const busFaults = selectionMode ? getBusFaultLevels() : new Map<string, { faultA: number; label: string }>();
  const busLines: { id: string; label: string; faultA: number; color: string; factor: number }[] = [];
  if (selectionMode) {
    selection.forEach((id, idx) => {
      const comp = byId.get(id)!;
      if (comp.type !== "busbar") return;
      const bf = busFaults.get(id);
      if (bf) {
        busLines.push({ id, label: bf.label, faultA: bf.faultA, color: GRADING_COLORS[idx % GRADING_COLORS.length], factor: factorFor(compKv.get(id)) });
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
    const f = factorFor(e.kv);
    if (e.kind === "relay") {
      const links = getRelayLinks(e.device.id);
      const pickup = primaryPickupA(e.device.parameters as RelayParams, links.ct);
      const highest = relayHighestPickupA(e.device.parameters as RelayParams, links.ct);
      maxI = Math.max(maxI, pickup * 30 * f, highest * 2 * f);
    } else if (e.kind === "fuse") {
      maxI = Math.max(maxI, (e.device.parameters as FuseParams).rated_current_a * 30 * f);
    } else if (e.kind === "motor") {
      const md = motorData.get(e.device.id);
      if (md) maxI = Math.max(maxI, md.startA * 2 * f);
    } else if (e.kind === "cable") {
      const csa = (e.device.parameters as CableParams).csa_mm2 ?? 120;
      // Cover the damage current at 1 s so a useful stretch of the curve shows.
      maxI = Math.max(maxI, CABLE_K_CU_XLPE * csa * 1.2 * f);
    } else if (e.kind === "transformer") {
      const p = e.device.parameters as TransformerParams;
      const inA = (p.rated_mva * 1000) / (Math.sqrt(3) * p.primary_kv);
      maxI = Math.max(maxI, inA * 27.5 * f);
    }
  }
  // Fault currents are at each relay's own bus voltage — refer them too.
  for (const e of relayEntries) {
    const fc = faultCurrents.get(e.device.id);
    if (fc) maxI = Math.max(maxI, fc.primaryA * 1.3 * factorFor(e.kv));
  }
  for (const b of busLines) maxI = Math.max(maxI, b.faultA * 1.3 * b.factor);
  const xMaxDecade = Math.ceil(Math.log10(maxI));
  const xMinDecade = 1; // 10 A
  const iMin = Math.pow(10, xMinDecade);
  const iMax = Math.pow(10, xMaxDecade);

  // ---- Build curves ----
  const curves: DeviceCurve[] = [];
  const dots: DotMarker[] = [];
  for (const e of entries) {
    const c = e.device;
    const f = factorFor(e.kv);
    const sampleMax = iMax / f; // actual amps; ×f lands the curve at iMax on the chart
    if (e.kind === "relay") {
      const links = getRelayLinks(c.id);
      const rp = c.parameters as RelayParams;
      const pts = idmtCurvePoints(rp, links.ct, sampleMax, tMax, tMin);
      if (pts.length === 0) continue;
      const stageCount = 1 + ((rp.stage2_enabled ?? false) ? 1 : 0) + ((rp.stage3_enabled ?? false) ? 1 : 0);
      curves.push({
        id: c.id,
        label: `${c.label}${e.via ? ` (${e.via})` : ""} · ${stageCount > 1 ? `${stageCount}-stage ` : ""}${CURVE_LABELS[rp.curve]}`,
        color: e.color,
        dash: DASH.relay,
        points: pts,
        factor: f,
      });
      // Thermal overload element (49) — a separate long-time curve.
      if (rp.thermal_enabled ?? false) {
        const tpts = thermalCurvePoints(rp, links.ct, sampleMax, tMax, tMin);
        if (tpts.length > 0) {
          curves.push({
            id: `${c.id}-thermal`,
            label: `${c.label} · thermal 49 (τ${rp.thermal_tau_min ?? 15}m)`,
            color: e.color,
            dash: DASH.thermal,
            points: tpts,
            factor: f,
          });
        }
      }
    } else if (e.kind === "fuse") {
      const pts = fuseTccPoints(c.parameters as FuseParams, sampleMax, tMax, tMin);
      if (pts.length === 0) continue;
      curves.push({
        id: c.id,
        label: `${c.label} · ${(c.parameters as FuseParams).rated_current_a} A fuse (approx.)`,
        color: e.color,
        dash: DASH.fuse,
        points: pts,
        factor: f,
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
        factor: f,
      });
    } else if (e.kind === "cable") {
      const csa = (c.parameters as CableParams).csa_mm2 ?? 120;
      const pts = cableDamageCurvePoints(csa, sampleMax, tMax, tMin);
      if (pts.length === 0) continue;
      curves.push({
        id: c.id,
        label: `${c.label} · ${csa} mm² damage`,
        color: e.color,
        dash: DASH.cable,
        points: pts,
        factor: f,
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
        factor: f,
      });
      const inrush = transformerInrushPoint(inA);
      dots.push({
        id: `inrush-${c.id}`,
        i: inrush.i,
        t: inrush.t,
        color: e.color,
        label: `${c.label} inrush ~12×In`,
        factor: f,
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

  const pathFor = (pts: { i: number; t: number }[], factor = 1) =>
    pts
      .map((p, k) => `${k === 0 ? "M" : "L"}${xAt(p.i * factor).toFixed(1)},${yAt(clampT(p.t)).toFixed(1)}`)
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
    factor: number;
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
      factor: factorFor(e.kv),
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
    const rows: string[][] = [];
    rows.push([`Reference voltage: ${refKv ? fmtKv(refKv) : "each device's own level"}`]);
    rows.push(["Currents below are actual amps at each device's own voltage."]);
    rows.push([]);
    rows.push(["Device", "Current [A]", "Operate/withstand time [s]"]);
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
          <label style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 4 }}>
            Refer to:
            <select
              value={refKv ?? ""}
              onChange={(e) => setGradingRefKv(e.target.value ? parseFloat(e.target.value) : null)}
              style={{ fontSize: 11, padding: "1px 4px" }}
              title="Refer every curve to one common voltage level via the transformer ratios"
            >
              <option value="">each device's own kV</option>
              {kvLevels.map((kv) => (
                <option key={kv} value={kv}>{fmtKv(kv)}</option>
              ))}
            </select>
          </label>
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
            {refKv ? `Current [A] — referred to ${fmtKv(refKv)}` : "Current [A] — at each device's own voltage level"}
          </text>

          {/* fault markers (behind curves) — referred to the chart voltage */}
          {markers.map((m) => (
            <line
              key={`fm-${m.relayId}`}
              x1={xAt(Math.min(m.faultA * m.factor, iMax))}
              x2={xAt(Math.min(m.faultA * m.factor, iMax))}
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
            b.faultA * b.factor <= iMax ? (
              <g key={`bus-${b.id}`}>
                <line
                  x1={xAt(b.faultA * b.factor)}
                  x2={xAt(b.faultA * b.factor)}
                  y1={padT}
                  y2={padT + plotH}
                  stroke={b.color}
                  strokeWidth={1.6}
                  opacity={0.9}
                />
                <text
                  x={xAt(b.faultA * b.factor)}
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
              d={pathFor(c.points, c.factor)}
              fill="none"
              stroke={c.color}
              strokeWidth={1.8}
              strokeDasharray={c.dash}
            />
          ))}

          {/* transformer inrush points */}
          {dots.map((d) =>
            d.i * d.factor <= iMax ? (
              <g key={d.id}>
                <circle
                  cx={xAt(d.i * d.factor)}
                  cy={yAt(clampT(d.t))}
                  r={4}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={1.6}
                />
                <circle cx={xAt(d.i * d.factor)} cy={yAt(clampT(d.t))} r={1.4} fill={d.color} />
                <title>{d.label}</title>
              </g>
            ) : null,
          )}

          {/* operate-time dots */}
          {markers.map((m) =>
            isFinite(m.operateS) ? (
              <circle
                key={`dot-${m.relayId}`}
                cx={xAt(Math.min(m.faultA * m.factor, iMax))}
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

        {refKv && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "2px 4px", lineHeight: 1.5 }}>
            Curves referred to {fmtKv(refKv)} through transformer ratios (Iₚₗₒₜ = I × kV<sub>device</sub> / {fmtKv(refKv)}). Tables below show actual amps at each device.
          </div>
        )}

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
