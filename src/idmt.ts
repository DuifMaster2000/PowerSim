// =====================================================================
// IDMT (inverse definite minimum time) overcurrent relay curve maths.
// Pure module — no React, no store, no solver imports. Shared by the UI
// (grading chart) and trivially unit-testable. Single source of truth for
// the time–current characteristics. IEC 60255-151.
// =====================================================================

import type { RelayParams, CtParams, FuseParams, IdmtCurve } from "./types";

// (K, α) constants for the IEC standard inverse-time families.
// t = TMS · K / ((I/Is)^α − 1)
const IEC_CONSTANTS: Record<Exclude<IdmtCurve, "DT">, { k: number; alpha: number }> = {
  "IEC-SI": { k: 0.14, alpha: 0.02 },
  "IEC-VI": { k: 13.5, alpha: 1.0 },
  "IEC-EI": { k: 80.0, alpha: 2.0 },
  "IEC-LTI": { k: 120.0, alpha: 1.0 },
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

// Operate time (seconds) of a relay at a given primary current. Returns
// Infinity below pickup (the relay never operates).
export function idmtOperateTime(
  relay: RelayParams,
  ct: CtParams | null,
  primaryCurrentA: number,
): number {
  const isA = primaryPickupA(relay, ct);
  if (isA <= 0 || primaryCurrentA <= isA) return Infinity;

  if (relay.curve === "DT") {
    return relay.definite_time_s;
  }

  const { k, alpha } = IEC_CONSTANTS[relay.curve];
  const m = primaryCurrentA / isA;
  return (relay.time_multiplier * k) / (Math.pow(m, alpha) - 1);
}

export interface CurvePoint {
  i: number; // primary current (A)
  t: number; // operate time (s)
}

// Sampled points for plotting, from just above pickup up to maxCurrentA.
// Time is clamped to [tMin, tMax] so a near-pickup asymptote doesn't blow the
// plot vertically. Logarithmically spaced for a smooth log–log line.
export function idmtCurvePoints(
  relay: RelayParams,
  ct: CtParams | null,
  maxCurrentA: number,
  tMax = 100,
  tMin = 0.01,
): CurvePoint[] {
  const isA = primaryPickupA(relay, ct);
  if (isA <= 0) return [];

  const points: CurvePoint[] = [];

  if (relay.curve === "DT") {
    // Horizontal shelf at definite_time_s from pickup to max current.
    const t = Math.min(Math.max(relay.definite_time_s, tMin), tMax);
    points.push({ i: isA * 1.0001, t });
    points.push({ i: Math.max(maxCurrentA, isA * 1.0001), t });
    return points;
  }

  const startA = isA * 1.02; // just above pickup to avoid the vertical asymptote
  const endA = Math.max(maxCurrentA, startA * 1.1);
  const steps = 120;
  const logStart = Math.log10(startA);
  const logEnd = Math.log10(endA);
  for (let s = 0; s <= steps; s++) {
    const i = Math.pow(10, logStart + ((logEnd - logStart) * s) / steps);
    const t = idmtOperateTime(relay, ct, i);
    if (!isFinite(t)) continue;
    if (t > tMax) continue; // off the top of the chart near pickup
    if (t < tMin) break; // bottomed out — clip the high-current tail
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
