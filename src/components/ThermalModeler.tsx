// =====================================================================
// GE 869 Thermal Scenario Modeler.
// A self-contained sandbox: define a current-vs-time scenario (phases),
// tune the 869 thermal settings, and watch Thermal Capacity Used (TCU)
// integrate over time on a live chart. Uses the pure Relay869ThermalModel
// engine. Not tied to the project file — purely exploratory.
// =====================================================================

import { useMemo, useState, useEffect } from "react";
import { useStore } from "../store";
import {
  Relay869ThermalModel,
  DEFAULT_869_THERMAL,
  type Relay869ThermalSettings,
  type MotorStatus,
} from "../protection/relay869Thermal";

interface Phase {
  id: number;
  label: string;
  mult: number;       // current as a multiple of FLA
  durS: number;       // duration (s)
  status: MotorStatus;
  i2pct: number;      // negative-sequence as % of phase current (unbalance)
  rtdTempC: number;   // stator RTD temperature for this phase (if RTD enabled)
}

let _pid = 1;
const phase = (p: Partial<Phase>): Phase => ({
  id: _pid++, label: "phase", mult: 1, durS: 60, status: "RUNNING", i2pct: 0, rtdTempC: 40, ...p,
});

const DEFAULT_PHASES: Phase[] = [
  phase({ label: "DOL start", mult: 6, durS: 8, status: "STARTING" }),
  phase({ label: "Run (rated)", mult: 1.0, durS: 180, status: "RUNNING" }),
  phase({ label: "Overload", mult: 3.0, durS: 8, status: "OVERLOAD" }),
  phase({ label: "Recover", mult: 1.0, durS: 300, status: "RUNNING" }),
];

interface Sample { t: number; tcu: number; mult: number; }
interface SimResult {
  samples: Sample[];
  tripT: number | null;
  alarmT: number | null;
  peak: number;
  finalTcu: number;
  total: number;
  curMax: number;
}

function simulate(settings: Relay869ThermalSettings, phases: Phase[]): SimResult {
  const total = Math.max(1, phases.reduce((s, p) => s + p.durS, 0));
  const dt = Math.max(0.05, total / 3000);
  const model = new Relay869ThermalModel(settings);
  const raw: Sample[] = [];
  let t = 0, tripT: number | null = null, alarmT: number | null = null, peak = 0, curMax = 2;
  for (const ph of phases) {
    const I = ph.mult * settings.fla;
    curMax = Math.max(curMax, ph.mult);
    const steps = Math.max(1, Math.round(ph.durS / dt));
    for (let s = 0; s < steps; s++) {
      const hasUnbal = ph.i2pct > 0;
      const r = model.step({
        dtSeconds: dt,
        ia: I, ib: I, ic: I,
        i1: hasUnbal ? I : undefined,
        i2: hasUnbal ? (I * ph.i2pct) / 100 : undefined,
        status: ph.status,
        rtdTempC: settings.rtd_bias_enabled ? ph.rtdTempC : undefined,
      });
      t += dt;
      peak = Math.max(peak, r.tcu);
      if (r.tripOp && tripT === null) tripT = t;
      if (r.alarmOp && alarmT === null) alarmT = t;
      raw.push({ t, tcu: r.tcu, mult: ph.mult });
    }
  }
  // Subsample to keep the SVG path light.
  const step = Math.max(1, Math.floor(raw.length / 600));
  const samples = raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
  return { samples, tripT, alarmT, peak, finalTcu: model.thermalCapacityUsed, total, curMax };
}

const STATUSES: MotorStatus[] = ["STARTING", "RUNNING", "OVERLOAD", "STOPPED"];

// Numeric settings the modeler exposes as <input type=number> (all number-typed).
type NumKey =
  | "fla" | "ol" | "td_multiplier" | "iec_curve_k_factor"
  | "iec_time_constant_1_min" | "iec_time_constant_2_min"
  | "cool_time_const_running_min" | "cool_time_const_stopped_min"
  | "hot_cold_safe_stall_ratio" | "unbalance_bias_k" | "alarm_pickup_pct"
  | "rtd_bias_center_c" | "rtd_bias_max_c";

const fmtTime = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s` : `${s.toFixed(0)}s`);

export function ThermalModeler() {
  const open = useStore((s) => s.thermalModelerOpen);
  const seed = useStore((s) => s.thermalModelerSeed);
  const close = useStore((s) => s.closeThermalModeler);

  // Seed a sensible motor TD multiplier (the GE default of 1.0 nuisance-trips
  // on a typical 6×FLA start) so the first open is illustrative, not an
  // instant trip. A relay seed overrides this.
  const [settings, setSettings] = useState<Relay869ThermalSettings>({ ...DEFAULT_869_THERMAL, trip_function: "Trip", td_multiplier: 4 });
  const [phases, setPhases] = useState<Phase[]>(DEFAULT_PHASES);

  // Seed FLA / OL / TDM from the relay that opened the modeler (once per open).
  useEffect(() => {
    if (open && seed) {
      setSettings((s) => ({ ...s, fla: seed.fla || s.fla, ol: seed.ol || s.ol, td_multiplier: seed.tdm || s.td_multiplier }));
    }
  }, [open, seed]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const sim = useMemo(() => simulate(settings, phases), [settings, phases]);

  if (!open) return null;

  const set = <K extends keyof Relay869ThermalSettings>(k: K, v: Relay869ThermalSettings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));
  const isIEC = settings.overload_curve === "IEC";

  // ---- chart geometry ----
  const W = 760, H = 240, padL = 44, padR = 44, padT = 26, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const yMax = Math.max(110, Math.ceil(sim.peak / 25) * 25);
  const curMax = Math.max(2, Math.ceil(sim.curMax));
  const xAt = (t: number) => padL + (t / sim.total) * plotW;
  const yTcu = (v: number) => padT + (1 - v / yMax) * plotH;
  const yCur = (c: number) => padT + (1 - c / curMax) * plotH;
  const tcuPath = sim.samples.map((p, i) => `${i ? "L" : "M"}${xAt(p.t).toFixed(1)},${yTcu(p.tcu).toFixed(1)}`).join(" ");
  const curPath = sim.samples.map((p, i) => `${i ? "L" : "M"}${xAt(p.t).toFixed(1)},${yCur(p.mult).toFixed(1)}`).join(" ");

  // phase boundary times
  let acc = 0;
  const bounds = phases.map((p) => (acc += p.durS));

  const num = (k: NumKey, label: string, step = 1, min?: number, max?: number, unit?: string) => (
    <label className="tm-field">
      <span>{label}{unit ? ` [${unit}]` : ""}</span>
      <input
        type="number" step={step} min={min} max={max}
        value={settings[k]}
        onChange={(e) => setSettings((s) => ({ ...s, [k]: parseFloat(e.target.value) || 0 }))}
      />
    </label>
  );

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal tm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Thermal scenario modeler">
        <div className="tm-header">
          <h2>GE 869 — Thermal Scenario Modeler</h2>
          <button className="glossary-close" onClick={close} aria-label="Close">×</button>
        </div>

        <div className="tm-body">
          {/* ---- settings ---- */}
          <div className="tm-settings">
            <h4>Thermal model settings</h4>
            <div className="tm-grid">
              <label className="tm-field">
                <span>Overload curve</span>
                <select value={settings.overload_curve} onChange={(e) => set("overload_curve", e.target.value as Relay869ThermalSettings["overload_curve"])}>
                  <option value="Standard">Standard</option>
                  <option value="IEC">IEC 255-8</option>
                </select>
              </label>
              {!isIEC && (
                <label className="tm-field">
                  <span>Curve effect</span>
                  <select value={settings.curve_effect} onChange={(e) => set("curve_effect", e.target.value as Relay869ThermalSettings["curve_effect"])}>
                    <option value="Cutoff">Cutoff</option>
                    <option value="Shift">Shift</option>
                  </select>
                </label>
              )}
              {num("fla", "Motor FLA", 1, 1, undefined, "A")}
              {num("ol", "Overload factor (OL)", 0.05, 1, 1.5)}
              {!isIEC && num("td_multiplier", "TD multiplier", 0.5, 1, 25)}
              {isIEC && num("iec_curve_k_factor", "k factor", 0.05, 1, 1.5)}
              {isIEC && num("iec_time_constant_1_min", "τ1 stator", 1, 0, 1000, "min")}
              {isIEC && num("iec_time_constant_2_min", "τ2 rotor", 1, 0, 1000, "min")}
              {num("cool_time_const_running_min", "Cool τ running", 1, 0, 1000, "min")}
              {num("cool_time_const_stopped_min", "Cool τ stopped", 1, 0, 1000, "min")}
              {num("hot_cold_safe_stall_ratio", "Hot/cold ratio", 0.05, 0.01, 1)}
              {num("unbalance_bias_k", "Unbalance K", 1, 0, 19)}
              <label className="tm-field">
                <span>Trip function</span>
                <select value={settings.trip_function} onChange={(e) => set("trip_function", e.target.value as Relay869ThermalSettings["trip_function"])}>
                  <option value="Trip">Trip</option>
                  <option value="LatchedTrip">Latched</option>
                  <option value="Configurable">Configurable</option>
                  <option value="Disabled">Disabled</option>
                </select>
              </label>
              <label className="tm-field tm-check">
                <span>Alarm</span>
                <input type="checkbox" checked={settings.alarm_enabled} onChange={(e) => set("alarm_enabled", e.target.checked)} />
              </label>
              {settings.alarm_enabled && num("alarm_pickup_pct", "Alarm pickup", 5, 0, 100, "%")}
              <label className="tm-field tm-check">
                <span>RTD bias</span>
                <input type="checkbox" checked={settings.rtd_bias_enabled} onChange={(e) => set("rtd_bias_enabled", e.target.checked)} />
              </label>
              {settings.rtd_bias_enabled && num("rtd_bias_center_c", "RTD center", 5, 0, 300, "°C")}
              {settings.rtd_bias_enabled && num("rtd_bias_max_c", "RTD max", 5, 0, 300, "°C")}
            </div>
            <p className="tm-note">
              Pickup = OL × FLA = <b>{(settings.ol * settings.fla).toFixed(0)} A</b>.
              {isIEC ? " IEC hot/cold replica with τ1 (stator) / τ2 (rotor)." : " Standard GE curve (exact coefficients)."}
            </p>
          </div>

          {/* ---- scenario phases ---- */}
          <div className="tm-scenario">
            <h4>Scenario <span className="tm-dim">— current profile fed to the model</span></h4>
            <table className="tm-phases">
              <thead>
                <tr>
                  <th>Phase</th><th>×FLA</th><th>Duration</th><th>Status</th><th>I2/I1 %</th>
                  {settings.rtd_bias_enabled && <th>RTD °C</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {phases.map((p, i) => {
                  const upd = (patch: Partial<Phase>) => setPhases((ps) => ps.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
                  return (
                    <tr key={p.id}>
                      <td><input value={p.label} onChange={(e) => upd({ label: e.target.value })} /></td>
                      <td><input type="number" step={0.1} min={0} value={p.mult} onChange={(e) => upd({ mult: parseFloat(e.target.value) || 0 })} /></td>
                      <td><input type="number" step={1} min={0} value={p.durS} onChange={(e) => upd({ durS: parseFloat(e.target.value) || 0 })} /></td>
                      <td>
                        <select value={p.status} onChange={(e) => upd({ status: e.target.value as MotorStatus })}>
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td><input type="number" step={5} min={0} max={100} value={p.i2pct} onChange={(e) => upd({ i2pct: parseFloat(e.target.value) || 0 })} /></td>
                      {settings.rtd_bias_enabled && <td><input type="number" step={5} value={p.rtdTempC} onChange={(e) => upd({ rtdTempC: parseFloat(e.target.value) || 0 })} /></td>}
                      <td><button className="tm-x" onClick={() => setPhases((ps) => ps.filter((x) => x.id !== p.id))} disabled={phases.length <= 1}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button className="tm-add" onClick={() => setPhases((ps) => [...ps, phase({ label: `phase ${ps.length + 1}` })])}>+ Add phase</button>
          </div>

          {/* ---- chart ---- */}
          <div className="tm-chart">
            <svg viewBox={`0 0 ${W} ${H}`} width="100%">
              {/* TCU gridlines + labels (left) */}
              {[0, 25, 50, 75, 100].map((v) => (
                <g key={v}>
                  <line x1={padL} x2={padL + plotW} y1={yTcu(v)} y2={yTcu(v)} stroke="var(--border)" />
                  <text x={padL - 6} y={yTcu(v) + 3} fontSize={9} textAnchor="end" fill="var(--text-muted)" fontFamily="var(--font-mono)">{v}</text>
                </g>
              ))}
              {/* current axis labels (right) */}
              {[0, curMax / 2, curMax].map((c) => (
                <text key={c} x={padL + plotW + 6} y={yCur(c) + 3} fontSize={9} textAnchor="start" fill="var(--accent-dim)" fontFamily="var(--font-mono)">{c.toFixed(0)}×</text>
              ))}
              {/* phase bands + boundaries */}
              {bounds.map((b, i) => (
                <g key={i}>
                  <line x1={xAt(b)} x2={xAt(b)} y1={padT} y2={padT + plotH} stroke="var(--border)" strokeDasharray="2 3" opacity={0.6} />
                  {phases[i] && (
                    <text x={xAt((i ? bounds[i - 1] : 0))} y={padT - 4} fontSize={8} fill="var(--text-dim)" fontFamily="var(--font-mono)">
                      {phases[i].label}
                    </text>
                  )}
                </g>
              ))}
              {/* 100% trip + alarm lines */}
              <line x1={padL} x2={padL + plotW} y1={yTcu(100)} y2={yTcu(100)} stroke="var(--bad)" strokeWidth={1.2} strokeDasharray="5 3" />
              {settings.alarm_enabled && <line x1={padL} x2={padL + plotW} y1={yTcu(settings.alarm_pickup_pct)} y2={yTcu(settings.alarm_pickup_pct)} stroke="var(--warn)" strokeWidth={1} strokeDasharray="4 4" />}
              {/* current overlay */}
              <path d={curPath} fill="none" stroke="var(--accent-dim)" strokeWidth={1} opacity={0.7} />
              {/* TCU line */}
              <path d={tcuPath} fill="none" stroke="var(--accent)" strokeWidth={2} />
              {/* trip marker */}
              {sim.tripT !== null && (
                <g>
                  <line x1={xAt(sim.tripT)} x2={xAt(sim.tripT)} y1={padT} y2={padT + plotH} stroke="var(--bad)" strokeWidth={1.4} />
                  <text x={xAt(sim.tripT) + 3} y={padT + 10} fontSize={9} fill="var(--bad)" fontFamily="var(--font-mono)">TRIP {fmtTime(sim.tripT)}</text>
                </g>
              )}
              <text x={padL - 34} y={padT + plotH / 2} fontSize={9} fill="var(--accent)" textAnchor="middle" transform={`rotate(-90 ${padL - 34} ${padT + plotH / 2})`}>TCU %</text>
              <text x={padL + plotW / 2} y={H - 4} fontSize={9} fill="var(--text-dim)" textAnchor="middle">time → {fmtTime(sim.total)} total</text>
            </svg>
            <div className="tm-summary">
              <span><b style={{ color: "var(--accent)" }}>{sim.finalTcu.toFixed(1)}%</b> final TCU</span>
              <span>peak {sim.peak.toFixed(1)}%</span>
              {sim.tripT !== null ? <span style={{ color: "var(--bad)" }}>TRIPS at {fmtTime(sim.tripT)}</span> : <span style={{ color: "var(--ok, #38d39f)" }}>no trip</span>}
              {settings.alarm_enabled && <span style={{ color: "var(--warn)" }}>{sim.alarmT !== null ? `alarm at ${fmtTime(sim.alarmT)}` : "no alarm"}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
