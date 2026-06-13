// =====================================================================
// IDMT (inverse definite minimum time) overcurrent relay curve maths.
// Pure module — no React, no store, no solver imports. Shared by the UI
// (grading chart) and trivially unit-testable. Single source of truth for
// the time–current characteristics. IEC 60255-151.
// =====================================================================

import type { RelayParams, CtParams, FuseParams, IdmtCurve } from "./types";

// (K, α) constants for the IEC standard inverse-time families.
// t = TMS · K / ((I/Is)^α − 1)
const IEC_CONSTANTS: Record<"IEC-SI" | "IEC-VI" | "IEC-EI" | "IEC-LTI", { k: number; alpha: number }> = {
  "IEC-SI": { k: 0.14, alpha: 0.02 },
  "IEC-VI": { k: 13.5, alpha: 1.0 },
  "IEC-EI": { k: 80.0, alpha: 2.0 },
  "IEC-LTI": { k: 120.0, alpha: 1.0 },
};

// (A, B, p) constants for the IEEE C37.112 inverse-time families.
// t = TDM · ( A / ((I/Is)^p − 1) + B )  — used by GE and other ANSI relays.
const IEEE_CONSTANTS: Record<"IEEE-MI" | "IEEE-VI" | "IEEE-EI", { a: number; b: number; p: number }> = {
  "IEEE-MI": { a: 0.0515, b: 0.1140, p: 0.02 },
  "IEEE-VI": { a: 19.61, b: 0.491, p: 2.0 },
  "IEEE-EI": { a: 28.2, b: 0.1217, p: 2.0 },
};

// Default CT primary used when a relay has no CT wired to it. The grading view
// can still draw a curve, and validation surfaces a warning to wire a CT.
const FALLBACK_CT_PRIMARY_A = 100;

// Primary-referred pickup current. Plug setting is a multiple of the CT
// secondary rating, so referred to the primary it scales by the CT primary
// rating (In_primary = CT primary rating).
export function primaryPickupA(relay: RelayParams, ct: CtParams | null): number {
  const inPrimary = ct ? ct.primary_a : FALLBACK_CT_PRIMARY_A;
  return relay.plug_setting * inPrimary;
}

// Operate time of one overcurrent stage at a given primary current.
// Infinity below pickup.
function stageOperateTime(
  curve: IdmtCurve,
  tms: number,
  dtSeconds: number,
  pickupA: number,
  primaryCurrentA: number,
): number {
  if (pickupA <= 0 || primaryCurrentA <= pickupA) return Infinity;

  if (curve === "DT") return dtSeconds;

  const m = primaryCurrentA / pickupA;

  if (curve === "ABB-RI") {
    // ABB RI inverse (Relion): t = k / (0.339 − 0.236/m). Flattens toward
    // ~2.95·k at high multiples instead of racing to zero like IEC curves —
    // that near-constant tail is what grades it against old ABB disc relays.
    return tms / (0.339 - 0.236 / m);
  }

  if (curve === "IEEE-MI" || curve === "IEEE-VI" || curve === "IEEE-EI") {
    // IEEE C37.112: t = TDM·( A/(m^p − 1) + B ).
    const { a, b, p } = IEEE_CONSTANTS[curve];
    return tms * (a / (Math.pow(m, p) - 1) + b);
  }

  const { k, alpha } = IEC_CONSTANTS[curve];
  return (tms * k) / (Math.pow(m, alpha) - 1);
}

// All enabled stage pickups in primary amps, lowest first. Stage 1 is always
// on; stages 2/3 exist on multi-stage models (legacy params default to off).
function enabledStagePickupsA(relay: RelayParams, ct: CtParams | null): number[] {
  const inPrimary = ct ? ct.primary_a : FALLBACK_CT_PRIMARY_A;
  const pickups = [relay.plug_setting * inPrimary];
  if (relay.stage2_enabled ?? false) pickups.push((relay.stage2_pickup ?? 5) * inPrimary);
  if (relay.stage3_enabled ?? false) pickups.push((relay.stage3_pickup ?? 20) * inPrimary);
  return pickups.sort((a, b) => a - b);
}

// Highest enabled stage pickup — lets the chart extend its axis so the
// instantaneous step is visible.
export function relayHighestPickupA(relay: RelayParams, ct: CtParams | null): number {
  const p = enabledStagePickupsA(relay, ct);
  return p[p.length - 1];
}

// Operate time (seconds) of the relay at a given primary current: the minimum
// over all enabled stages (a real multi-stage relay trips on whichever stage
// operates first). Returns Infinity below every pickup.
export function idmtOperateTime(
  relay: RelayParams,
  ct: CtParams | null,
  primaryCurrentA: number,
): number {
  const inPrimary = ct ? ct.primary_a : FALLBACK_CT_PRIMARY_A;

  let t = stageOperateTime(
    relay.curve,
    relay.time_multiplier,
    relay.definite_time_s,
    relay.plug_setting * inPrimary,
    primaryCurrentA,
  );

  if (relay.stage2_enabled ?? false) {
    t = Math.min(t, stageOperateTime(
      relay.stage2_curve ?? "DT",
      relay.stage2_tms ?? 0.1,
      relay.stage2_time_s ?? 0.3,
      (relay.stage2_pickup ?? 5) * inPrimary,
      primaryCurrentA,
    ));
  }

  if (relay.stage3_enabled ?? false) {
    t = Math.min(t, stageOperateTime(
      "DT",
      0,
      relay.stage3_time_s ?? 0.05,
      (relay.stage3_pickup ?? 20) * inPrimary,
      primaryCurrentA,
    ));
  }

  return t;
}

export interface CurvePoint {
  i: number; // primary current (A)
  t: number; // operate time (s)
}

// Sampled points for plotting, from just above the lowest enabled pickup up
// to maxCurrentA. Extra sample pairs straddle every enabled stage pickup so
// a multi-stage relay renders crisp vertical steps where a faster stage takes
// over. Time is clamped to [tMin, tMax] so a near-pickup asymptote doesn't
// blow the plot vertically. Logarithmically spaced for a smooth log–log line.
export function idmtCurvePoints(
  relay: RelayParams,
  ct: CtParams | null,
  maxCurrentA: number,
  tMax = 100,
  tMin = 0.01,
): CurvePoint[] {
  const pickups = enabledStagePickupsA(relay, ct);
  const isA = pickups[0];
  if (isA <= 0) return [];

  const startA = isA * 1.0001;
  const endA = Math.max(maxCurrentA, startA * 1.1);

  const samples: number[] = [];
  const steps = 140;
  const logStart = Math.log10(startA);
  const logEnd = Math.log10(endA);
  for (let s = 0; s <= steps; s++) {
    samples.push(Math.pow(10, logStart + ((logEnd - logStart) * s) / steps));
  }
  for (const p of pickups) {
    if (p > startA && p < endA) samples.push(p * 0.9995, p * 1.0005);
  }
  samples.sort((a, b) => a - b);

  const points: CurvePoint[] = [];
  for (const i of samples) {
    const t = idmtOperateTime(relay, ct, i);
    if (!isFinite(t)) continue;
    if (t > tMax) continue; // off the top of the chart near pickup
    if (t < tMin) break; // bottomed out — clip the high-current tail (monotone non-increasing)
    points.push({ i, t });
  }
  return points;
}

// Motor starting curve: the motor draws its (method-adjusted) locked-rotor
// current from the instant of starting until the run-up time, then drops back
// to full-load current. Any protection curve must sit ABOVE/right of this
// shape or the motor will trip on a normal start.
export function motorStartCurvePoints(
  flcA: number,
  startA: number,
  startTimeS: number,
  tMax = 100,
  tMin = 0.01,
): CurvePoint[] {
  if (flcA <= 0 || startA <= 0 || startTimeS <= 0) return [];
  const tStart = Math.min(Math.max(startTimeS, tMin * 2), tMax);
  return [
    { i: startA, t: tMin },
    { i: startA, t: tStart },
    { i: flcA, t: tStart },
    { i: flcA, t: tMax },
  ];
}

// Adiabatic withstand constant for copper / XLPE (IEC 60364-4-43 k-value),
// in A·√s per mm². Educational default — PVC copper would be ~115.
export const CABLE_K_CU_XLPE = 143;

// Cable thermal damage curve (adiabatic): I²t = (k·S)², i.e. I = k·S/√t.
// Protection must clear faults BELOW/left of this curve or the conductor
// insulation is damaged before the fault is removed.
export function cableDamageCurvePoints(
  csaMm2: number,
  maxCurrentA: number,
  tMax = 100,
  tMin = 0.01,
  k = CABLE_K_CU_XLPE,
): CurvePoint[] {
  const kS = k * csaMm2;
  if (kS <= 0) return [];
  const points: CurvePoint[] = [];
  const steps = 80;
  const logTMax = Math.log10(tMax);
  const logTMin = Math.log10(tMin);
  for (let s = 0; s <= steps; s++) {
    const t = Math.pow(10, logTMax - ((logTMax - logTMin) * s) / steps);
    const i = kS / Math.sqrt(t);
    if (i > maxCurrentA) break;
    points.push({ i, t });
  }
  return points;
}

// Transformer through-fault withstand, IEC 60076-5 / ANSI C57.109 category I:
// t = 1250 / m² for m = I/In between ~3.5× and 25×. Educational approximation.
export function transformerDamageCurvePoints(
  ratedInA: number,
  tMax = 100,
  tMin = 0.01,
): CurvePoint[] {
  if (ratedInA <= 0) return [];
  const points: CurvePoint[] = [];
  const steps = 60;
  const logMin = Math.log10(3.5);
  const logMax = Math.log10(25);
  for (let s = 0; s <= steps; s++) {
    const m = Math.pow(10, logMin + ((logMax - logMin) * s) / steps);
    const t = Math.min(1250 / (m * m), tMax);
    if (t < tMin) break;
    points.push({ i: m * ratedInA, t });
  }
  return points;
}

// Magnetising inrush reference point: ~12×In lasting ~0.1 s. Protection
// curves must pass above this dot or the transformer trips on energisation.
export function transformerInrushPoint(ratedInA: number): CurvePoint {
  return { i: 12 * ratedInA, t: 0.1 };
}

// Thermal overload element (49). Models motor winding heating; the curve
// asymptotes to ∞ at the continuous limit (k·Ib) and falls steeply at high
// current, so it must sit ABOVE the motor start curve and BELOW the
// motor/cable damage curves. Plotted for a COLD start (no prior load).
//
// Two characteristics, by relay model:
//  • ABB REM615 — IEC 60255-149 thermal replica:  t = τ·ln( I² / (I² − (k·Ib)²) )
//  • GE 869     — GE standard motor-overload curve: t = CM·87.4 / (m² − 1),
//                 m = I/(SF·Ib), CM the overload curve multiplier.
// Ib (base/FLC current) is thermal_base_a if set, else the CT primary rating
// (the CT is sized to the motor FLC). k is the overload / service factor.
export function thermalCurvePoints(
  relay: RelayParams,
  ct: CtParams | null,
  maxCurrentA: number,
  tMax = 100,
  tMin = 0.01,
): CurvePoint[] {
  if (!(relay.thermal_enabled ?? false)) return [];
  const baseSetting = relay.thermal_base_a ?? 0;
  const ib = baseSetting > 0 ? baseSetting : ct ? ct.primary_a : FALLBACK_CT_PRIMARY_A;
  const k = relay.thermal_k ?? 1.05;
  const pickup = k * ib; // continuous-overload limit (asymptote)
  if (pickup <= 0) return [];

  const isGE = relay.relay_model === "GE-869";
  const tauS = (relay.thermal_tau_min ?? 15) * 60;
  const cm = relay.thermal_curve_mult ?? 4;
  if (!isGE && tauS <= 0) return [];

  const points: CurvePoint[] = [];
  const startA = pickup * 1.02; // just above the continuous limit
  const endA = Math.max(maxCurrentA, startA * 1.1);
  const steps = 120;
  const logStart = Math.log10(startA);
  const logEnd = Math.log10(endA);
  for (let s = 0; s <= steps; s++) {
    const i = Math.pow(10, logStart + ((logEnd - logStart) * s) / steps);
    const m = i / pickup;
    const t = isGE
      ? (cm * 87.4) / (m * m - 1)
      : tauS * Math.log((i * i) / (i * i - pickup * pickup));
    if (!isFinite(t)) continue;
    if (t > tMax) continue; // off the top near the asymptote
    if (t < tMin) break; // bottomed out
    points.push({ i, t });
  }
  return points;
}

// Approximate gG fuse total-clearing time as an inverse band. This is a
// representative fit for educational overlay only — NOT manufacturer data.
// t ≈ A · (I / In)^(−B), clamped to the plot's time window.
export function fuseTccPoints(
  fuse: FuseParams,
  maxCurrentA: number,
  tMax = 100,
  tMin = 0.01,
): CurvePoint[] {
  const inA = fuse.rated_current_a;
  if (inA <= 0) return [];

  // gG fuses start melting around ~1.6× rated; aM (motor) curves sit higher.
  const A = fuse.fuse_class === "aM" ? 6e4 : 3e4;
  const B = 4.0;

  const points: CurvePoint[] = [];
  const startA = inA * 1.3;
  const endA = Math.max(maxCurrentA, startA * 1.1);
  const steps = 100;
  const logStart = Math.log10(startA);
  const logEnd = Math.log10(endA);
  for (let s = 0; s <= steps; s++) {
    const i = Math.pow(10, logStart + ((logEnd - logStart) * s) / steps);
    const t = A * Math.pow(i / inA, -B);
    if (t > tMax) continue;
    if (t < tMin) break;
    points.push({ i, t });
  }
  return points;
}
