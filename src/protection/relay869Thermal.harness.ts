// =====================================================================
// Validation / demonstration harness for the GE 869 Thermal Model.
// Runnable with:  npx tsx src/protection/relay869Thermal.harness.ts
// Not imported by the app — it exercises the model against the manual's
// documented behaviour and the Standard Curve TD Multipliers table.
// =====================================================================

import { Relay869ThermalModel, DEFAULT_869_THERMAL, type Relay869ThermalSettings, type MotorStatus } from "./relay869Thermal";

const spark = "▁▂▃▄▅▆▇█";
function sparkline(ys: number[], max = 100): string {
  return ys.map((y) => spark[Math.min(spark.length - 1, Math.max(0, Math.floor((y / max) * (spark.length - 1))))]).join("");
}
function settings(over: Partial<Relay869ThermalSettings>): Relay869ThermalSettings {
  return { ...DEFAULT_869_THERMAL, ...over };
}
// Drive the model at a constant per-unit current (×FLA) and return the time
// (s) at which it trips, plus the TCU trace.
function runConstant(m: Relay869ThermalModel, ieqPu: number, status: MotorStatus, maxS: number, dt = 0.1) {
  const fla = m.settings.fla;
  const trace: number[] = [];
  let tripT: number | null = null;
  for (let t = 0; t <= maxS; t += dt) {
    const I = ieqPu * fla;
    const r = m.step({ dtSeconds: dt, ia: I, ib: I, ic: I, status });
    if (t % (maxS / 40 < dt ? dt : maxS / 40) < dt) trace.push(r.tcu);
    if (r.tripOp && tripT === null) tripT = t;
  }
  return { tripT, trace };
}

console.log("============ GE 869 Thermal Model — validation ============\n");

// ---- 4. Numerical validation against the Standard Curve TD table (TDM x1) ----
console.log("Standard curve t_trip (OL irrelevant to curve, Cutoff, TDM=1):");
{
  const m = new Relay869ThermalModel(settings({ fla: 100, td_multiplier: 1, ol: 1.0, trip_function: "Trip" }));
  for (const [mult, expected] of [[2.0, 29.16], [3.0, 10.93], [5.0, 3.64]] as const) {
    const t = m.tripTime(mult);
    console.log(`  ${mult.toFixed(1)}×FLA → ${t.toFixed(2)} s   (manual ${expected} s)  ${Math.abs(t - expected) / expected < 0.01 ? "✓" : "✗"}`);
  }
}

// ---- a. Steady overload trips at the curve time ----
console.log("\n(a) Steady 3×FLA overload (expect trip ≈ 10.93 s):");
{
  const m = new Relay869ThermalModel(settings({ fla: 100, td_multiplier: 1, ol: 1.05, trip_function: "Trip" }));
  const { tripT, trace } = runConstant(m, 3.0, "OVERLOAD", 14);
  console.log(`  trip at ${tripT?.toFixed(2)} s   TCU: ${sparkline(trace)}`);
}

// ---- b. Cold start → run at rated → TCU settles at the hot/cold floor ----
console.log("\n(b) Cold start then rated load — TCU settles at a floor, not zero:");
{
  const m = new Relay869ThermalModel(settings({ fla: 100, ol: 1.05, hot_cold_safe_stall_ratio: 0.7, trip_function: "Trip" }));
  // brief 6×FLA start (1.5 s, ~60% TCU) then 1×FLA running for 90 min.
  for (let t = 0; t < 1.5; t += 0.1) m.step({ dtSeconds: 0.1, ia: 600, ib: 600, ic: 600, status: "STARTING" });
  const trace: number[] = [];
  for (let t = 0; t < 90 * 60; t += 2) {
    const r = m.step({ dtSeconds: 2, ia: 100, ib: 100, ic: 100, status: "RUNNING" });
    if (t % 270 < 2) trace.push(r.tcu);
  }
  const floor = (1.0 / 1.05) * (1 - 0.7) * 100;
  console.log(`  settled TCU ${m.thermalCapacityUsed.toFixed(1)}%   (expected floor ${floor.toFixed(1)}%)   TCU/min: ${sparkline(trace)}`);
}

// ---- c. Running vs stopped cooling time constants ----
console.log("\n(c) Cooling: running (τ=15 min) vs stopped (τ=30 min), from 80% TCU:");
{
  for (const [label, status, tau] of [["running", "RUNNING", 15], ["stopped", "STOPPED", 30]] as const) {
    const m = new Relay869ThermalModel(settings({ fla: 100, cool_time_const_running_min: 15, cool_time_const_stopped_min: 30, hot_cold_safe_stall_ratio: 1.0, trip_function: "Trip" }));
    (m as unknown as { tcu: number }).tcu = 80;
    const trace: number[] = [];
    for (let t = 0; t < 30 * 60; t += 5) {
      const r = m.step({ dtSeconds: 5, ia: 0, ib: 0, ic: 0, status });
      if (t % 120 < 5) trace.push(r.tcu);
    }
    console.log(`  ${label.padEnd(8)} after 30 min: ${m.thermalCapacityUsed.toFixed(1)}%  (e^(-30/${tau})·80 = ${(80 * Math.exp(-30 / tau)).toFixed(1)}%)  ${sparkline(trace)}`);
  }
}

// ---- d. Unbalance biasing (Eq 1), K=8 ≈ NEMA derating ----
console.log("\n(d) Unbalance biasing: balanced vs I2/I1=0.3 at K=8:");
{
  const m = new Relay869ThermalModel(settings({ fla: 100, unbalance_bias_k: 8 }));
  const bal = m.equivalentCurrent({ dtSeconds: 1, ia: 200, ib: 200, ic: 200, status: "OVERLOAD" });
  const unbal = m.equivalentCurrent({ dtSeconds: 1, ia: 200, ib: 200, ic: 200, i1: 200, i2: 60, status: "OVERLOAD" });
  console.log(`  balanced Ieq = ${bal.ieq.toFixed(1)} A (${bal.ieqPu.toFixed(2)}×FLA)`);
  console.log(`  unbalanced Ieq = ${unbal.ieq.toFixed(1)} A (${unbal.ieqPu.toFixed(2)}×FLA)  → ${(unbal.ieq / bal.ieq).toFixed(3)}× hotter (K=8, m=0.3 → √(1+8·0.09)=${Math.sqrt(1 + 8 * 0.09).toFixed(3)})`);
}

// ---- e. Power-loss while stopped decays TCU ----
console.log("\n(e) Power loss for 60 min while stopped (τ_stop=30 min), from 80%:");
{
  const m = new Relay869ThermalModel(settings({ fla: 100, cool_time_const_stopped_min: 30 }));
  (m as unknown as { tcu: number }).tcu = 80;
  m.applyControlPowerOutage({ durationMin: 60, statusAtLoss: "STOPPED", clockReliable: true });
  console.log(`  TCU on restore: ${m.thermalCapacityUsed.toFixed(1)}%  (80·e^(-60/30) = ${(80 * Math.exp(-2)).toFixed(1)}%)`);
  const m2 = new Relay869ThermalModel(settings({ fla: 100 }));
  (m2 as unknown as { tcu: number }).tcu = 80;
  m2.applyControlPowerOutage({ durationMin: 60, statusAtLoss: "RUNNING", clockReliable: true });
  console.log(`  (running at loss → unchanged): ${m2.thermalCapacityUsed.toFixed(1)}%`);
}

console.log("\n===========================================================");
