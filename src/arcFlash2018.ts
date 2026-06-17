// =====================================================================
// Arc-flash incident-energy model — IEEE 1584-2018 ("2nd edition").
//
// Pure module: no React, no store, no solver imports. The 2018 model uses
// five electrode configurations, computes arcing current / incident energy /
// arc-flash boundary at three voltage anchors (600 V, 2700 V, 14 300 V) and
// interpolates to the actual voltage, with an enclosure-size correction.
//
// Every coefficient is transcribed from IEEE 1584-2018 Tables 1–5 and 7, and
// every equation is reconstructed from Clause 4 and VALIDATED against the
// Annex D worked example (see arcFlash2018.harness.ts). Valid 208 V–15 kV,
// 0.5–106 kA.  Equation references (Eq n) cite the standard.
// =====================================================================

export type ElectrodeConfig = "VCB" | "VCBB" | "HCB" | "VOA" | "HOA";

export const ELECTRODE_CONFIGS: Record<ElectrodeConfig, string> = {
  VCB: "VCB — vertical conductors in a box",
  VCBB: "VCBB — vertical conductors into a barrier in a box",
  HCB: "HCB — horizontal conductors in a box",
  VOA: "VOA — vertical conductors in open air",
  HOA: "HOA — horizontal conductors in open air",
};

// ---- Table 1: arcing-current coefficients [k1..k10] per config per anchor ----
type C10 = [number, number, number, number, number, number, number, number, number, number];
const ARC: Record<ElectrodeConfig, { v600: C10; v2700: C10; v14300: C10 }> = {
  VCB: {
    v600: [-0.04287, 1.035, -0.083, 0, 0, -4.783e-9, 1.962e-6, -0.000229, 0.003141, 1.092],
    v2700: [0.0065, 1.001, -0.024, -1.557e-12, 4.556e-10, -4.186e-8, 8.346e-7, 5.482e-5, -0.003191, 0.9729],
    v14300: [0.005795, 1.015, -0.011, -1.557e-12, 4.556e-10, -4.186e-8, 8.346e-7, 5.482e-5, -0.003191, 0.9729],
  },
  VCBB: {
    v600: [-0.017432, 0.98, -0.05, 0, 0, -5.767e-9, 2.524e-6, -0.00034, 0.01187, 1.013],
    v2700: [0.002823, 0.995, -0.0125, 0, -9.204e-11, 2.901e-8, -3.262e-6, 0.0001569, -0.004003, 0.9825],
    v14300: [0.014827, 1.01, -0.01, 0, -9.204e-11, 2.901e-8, -3.262e-6, 0.0001569, -0.004003, 0.9825],
  },
  HCB: {
    v600: [0.054922, 0.988, -0.11, 0, 0, -5.382e-9, 2.316e-6, -0.000302, 0.0091, 0.9725],
    v2700: [0.001011, 1.003, -0.0249, 0, 0, 4.859e-10, -1.814e-7, -9.128e-6, -0.0007, 0.9881],
    v14300: [0.008693, 0.999, -0.02, 0, -5.043e-11, 2.233e-8, -3.046e-6, 0.000116, -0.001145, 0.9839],
  },
  VOA: {
    v600: [0.043785, 1.04, -0.18, 0, 0, -4.783e-9, 1.962e-6, -0.000229, 0.003141, 1.092],
    v2700: [-0.02395, 1.006, -0.0188, -1.557e-12, 4.556e-10, -4.186e-8, 8.346e-7, 5.482e-5, -0.003191, 0.9729],
    v14300: [0.005371, 1.0102, -0.029, -1.557e-12, 4.556e-10, -4.186e-8, 8.346e-7, 5.482e-5, -0.003191, 0.9729],
  },
  HOA: {
    v600: [0.111147, 1.008, -0.24, 0, 0, -3.895e-9, 1.641e-6, -0.000197, 0.002615, 1.1],
    v2700: [0.000435, 1.006, -0.038, 0, 0, 7.859e-10, -1.914e-7, -9.128e-6, -0.0007, 0.9981],
    v14300: [0.000904, 0.999, -0.02, 0, 0, 7.859e-10, -1.914e-7, -9.128e-6, -0.0007, 0.9981],
  },
};

// ---- Tables 3/4/5: incident-energy & AFB coefficients [k1..k13] per anchor ----
type C13 = [number, number, number, number, number, number, number, number, number, number, number, number, number];
const IE: Record<ElectrodeConfig, { v600: C13; v2700: C13; v14300: C13 }> = {
  VCB: {
    v600: [0.753364, 0.566, 1.752636, 0, 0, -4.783e-9, 1.962e-6, -0.000229, 0.003141, 1.092, 0, -1.598, 0.957],
    v2700: [2.40021, 0.165, 0.354202, -1.557e-12, 4.556e-10, -4.186e-8, 8.346e-7, 5.482e-5, -0.003191, 0.9729, 0, -1.569, 0.9778],
    v14300: [3.825917, 0.11, -0.999749, -1.557e-12, 4.556e-10, -4.186e-8, 8.346e-7, 5.482e-5, -0.003191, 0.9729, 0, -1.568, 0.99],
  },
  VCBB: {
    v600: [3.068459, 0.26, -0.098107, 0, 0, -5.767e-9, 2.524e-6, -0.00034, 0.01187, 1.013, -0.06, -1.809, 1.19],
    v2700: [3.870592, 0.185, -0.736618, 0, -9.204e-11, 2.901e-8, -3.262e-6, 0.0001569, -0.004003, 0.9825, 0, -1.742, 1.09],
    v14300: [3.644309, 0.215, -0.585522, 0, -9.204e-11, 2.901e-8, -3.262e-6, 0.0001569, -0.004003, 0.9825, 0, -1.677, 1.06],
  },
  HCB: {
    v600: [4.073745, 0.344, -0.370259, 0, 0, -5.382e-9, 2.316e-6, -0.000302, 0.0091, 0.9725, 0, -2.03, 1.036],
    v2700: [3.486391, 0.177, -0.193101, 0, 0, 4.859e-10, -1.814e-7, -9.128e-6, -0.0007, 0.9881, 0.027, -1.723, 1.055],
    v14300: [3.044516, 0.125, 0.245106, 0, -5.043e-11, 2.233e-8, -3.046e-6, 0.000116, -0.001145, 0.9839, 0, -1.655, 1.084],
  },
  VOA: {
    v600: [0.679294, 0.746, 1.222636, 0, 0, -4.783e-9, 1.962e-6, -0.000229, 0.003141, 1.092, 0, -1.598, 0.997],
    v2700: [3.880724, 0.105, -1.906033, -1.557e-12, 4.556e-10, -4.186e-8, 8.346e-7, 5.482e-5, -0.003191, 0.9729, 0, -1.515, 1.115],
    v14300: [3.405454, 0.12, -0.93245, -1.557e-12, 4.556e-10, -4.186e-8, 8.346e-7, 5.482e-5, -0.003191, 0.9729, 0, -1.534, 0.979],
  },
  HOA: {
    v600: [3.470417, 0.465, -0.261863, 0, 0, -3.895e-9, 1.641e-6, -0.000197, 0.002615, 1.1, 0, -1.99, 1.04],
    v2700: [3.616266, 0.149, -0.761561, 0, 0, 7.859e-10, -1.914e-7, -9.128e-6, -0.0007, 0.9981, 0, -1.639, 1.078],
    v14300: [2.04049, 0.177, 1.005092, 0, 0, 7.859e-10, -1.914e-7, -9.128e-6, -0.0007, 0.9981, -0.05, -1.633, 1.151],
  },
};

// ---- Table 2: arcing-current variation coefficients [k1..k7] ----
const VARCF: Record<ElectrodeConfig, number[]> = {
  VCB: [0, -1.4269e-6, 8.3137e-5, -0.0019382, 0.022366, -0.12645, 0.30226],
  VCBB: [1.138e-6, -6.0287e-5, 0.0012758, -0.013778, 0.080217, -0.24066, 0.33524],
  HCB: [0, -3.097e-6, 1.6405e-4, -0.0033609, 0.033308, -0.16182, 0.34627],
  VOA: [9.5606e-7, -5.1543e-5, 0.0011161, -0.01242, 0.075125, -0.23584, 0.33696],
  HOA: [0, -3.1555e-6, 1.682e-4, -0.0034607, 0.034124, -0.1599, 0.34629],
};

// ---- Table 7: enclosure-size correction coefficients [b1,b2,b3] ----
const CF_COEF: Record<"typical" | "shallow", Partial<Record<ElectrodeConfig, [number, number, number]>>> = {
  typical: { VCB: [-0.000302, 0.03441, 0.4325], VCBB: [-0.0002976, 0.032, 0.479], HCB: [-0.0001923, 0.01935, 0.6899] },
  shallow: { VCB: [0.002222, -0.02556, 0.6222], VCBB: [-0.002778, 0.1194, -0.2778], HCB: [-0.0005556, 0.03722, 0.4778] },
};

const lg = Math.log10;
const EB_J = 1.2 * 4.184; // arc-flash boundary energy threshold (1.2 cal/cm²)

// The shared 6th-order polynomial in Ibf using coefficients k4..k10 (Eq 1).
function poly6(c: C10 | C13, ibf: number): number {
  return c[3] * ibf ** 6 + c[4] * ibf ** 5 + c[5] * ibf ** 4 + c[6] * ibf ** 3 + c[7] * ibf ** 2 + c[8] * ibf + c[9];
}

// Eq 1 — intermediate arcing current (kA) at one voltage anchor.
function arcCurrentAnchor(c: C10, ibf: number, gap: number): number {
  return Math.pow(10, c[0] + c[1] * lg(ibf) + c[2] * lg(gap)) * poly6(c, ibf);
}

// Eq 3/4/5 — intermediate incident energy (J/cm²) at one anchor.
function energyAnchor(c: C13, t: number, gap: number, ibf: number, iarc: number, d: number, cf: number): number {
  const expo = c[0] + c[1] * lg(gap) + (c[2] * iarc) / (ibf * poly6(c, ibf))
    + c[10] * lg(ibf) + c[11] * lg(d) + c[12] * lg(iarc) + lg(1 / cf);
  return (12.552 / 50) * t * Math.pow(10, expo);
}

// Eq 7/8/9 — intermediate arc-flash boundary (mm): the energy equation solved
// for the distance D at which incident energy = 1.2 cal/cm².
function afbAnchor(c: C13, t: number, gap: number, ibf: number, iarc: number, cf: number): number {
  const rest = c[0] + c[1] * lg(gap) + (c[2] * iarc) / (ibf * poly6(c, ibf))
    + c[10] * lg(ibf) + c[12] * lg(iarc) + lg(1 / cf);
  return Math.pow(10, (lg(EB_J / ((12.552 / 50) * t)) - rest) / c[11]);
}

// Eq 11–15 — enclosure-size correction factor. VOA/HOA (open air) → 1.
function correctionFactor(config: ElectrodeConfig, voltageKv: number, widthMm: number, heightMm: number, shallow: boolean): number {
  if (config === "VOA" || config === "HOA") return 1;
  const adj = (dim: number): number => {
    // Eq 11/12: width/height mapped to the equivalent (inch) size by band.
    const d = Math.min(dim, 1244.6);
    if (d < 508) return shallow ? 0.03937 * d : 20;
    if (d <= 660.4) return 0.03937 * d;
    return (660.4 + (d - 660.4) * ((voltageKv + 4) / 20)) * 0.03937;
  };
  // Per Table 6, VCB uses the raw height (×0.03937) in the mid band; VCBB/HCB
  // apply the same voltage-adjusted mapping to height as to width.
  const width1 = adj(widthMm);
  const height1 = config === "VCB" && heightMm > 660.4 && heightMm <= 1244.6
    ? 0.03937 * heightMm
    : config === "VCB" && heightMm > 1244.6 ? 49 : adj(heightMm);
  let ees = (height1 + width1) / 2; // Eq 13
  ees = Math.max(ees, 20);          // typical-box minimum
  const b = CF_COEF[shallow ? "shallow" : "typical"][config] ?? CF_COEF.typical.VCB!;
  const cf = shallow ? 1 / (b[0] * ees * ees + b[1] * ees + b[2]) : b[0] * ees * ees + b[1] * ees + b[2];
  return cf;
}

export interface ArcFlash2018Input {
  config: ElectrodeConfig;
  voltageKv: number;       // open-circuit voltage Voc
  boltedKa: number;        // Ibf
  gapMm: number;           // conductor gap G
  workingDistanceMm: number; // D
  clearingTimeS: number;   // arc duration
  enclosureWidthMm?: number;  // for the size correction (boxed configs)
  enclosureHeightMm?: number;
  shallow?: boolean;       // shallow enclosure (LV, depth ≤ 203 mm)
}

export interface ArcFlash2018Result {
  arcingKa: number;
  arcingMinKa: number;       // reduced current for the variation check (Eq 2)
  incidentEnergyCal: number; // cal/cm² at the working distance
  arcFlashBoundaryMm: number;
  correctionFactor: number;
  inRange: boolean;          // 208 V–15 kV
}

// Eq 2 — arcing-current variation correction factor (a 6th-order polynomial).
function varCf(config: ElectrodeConfig, voltageKv: number): number {
  const k = VARCF[config];
  const v = voltageKv;
  return k[0] * v ** 6 + k[1] * v ** 5 + k[2] * v ** 4 + k[3] * v ** 3 + k[4] * v ** 2 + k[5] * v + k[6];
}

// Linear interpolation helper for the 4.9 anchor blending.
const interp = (lo: number, hi: number, span: number, voc: number, vRef: number, base: number) =>
  ((hi - lo) / span) * (voc - vRef) + base;

export function computeArcFlash2018(inp: ArcFlash2018Input): ArcFlash2018Result {
  const { config, voltageKv: V, boltedKa: Ibf, gapMm: G, workingDistanceMm: D, clearingTimeS } = inp;
  const T = clearingTimeS * 1000; // ms
  const cf = correctionFactor(config, V, inp.enclosureWidthMm ?? 508, inp.enclosureHeightMm ?? 508, inp.shallow ?? false);
  const inRange = V >= 0.208 && V <= 15;
  const vcf = 1 - 0.5 * varCf(config, V);

  if (V > 0.6) {
    // 600 V < Voc ≤ 15 kV — three anchors then interpolate (4.9).
    const a = ARC[config], e = IE[config];
    const Ia600 = arcCurrentAnchor(a.v600, Ibf, G), Ia2700 = arcCurrentAnchor(a.v2700, Ibf, G), Ia14300 = arcCurrentAnchor(a.v14300, Ibf, G);
    const E600 = energyAnchor(e.v600, T, G, Ibf, Ia600, D, cf), E2700 = energyAnchor(e.v2700, T, G, Ibf, Ia2700, D, cf), E14300 = energyAnchor(e.v14300, T, G, Ibf, Ia14300, D, cf);
    const B600 = afbAnchor(e.v600, T, G, Ibf, Ia600, cf), B2700 = afbAnchor(e.v2700, T, G, Ibf, Ia2700, cf), B14300 = afbAnchor(e.v14300, T, G, Ibf, Ia14300, cf);

    const pick = (x600: number, x2700: number, x14300: number) => {
      const x1 = interp(x600, x2700, 2.1, V, 2.7, x2700);   // Eq 16/19/22
      const x2 = interp(x2700, x14300, 11.6, V, 14.3, x14300); // Eq 17/20/23
      const x3 = x1 * ((2.7 - V) / 2.1) + x2 * ((V - 0.6) / 2.1); // Eq 18/21/24
      return V > 2.7 ? x2 : x3;
    };
    const iarc = pick(Ia600, Ia2700, Ia14300);
    return {
      arcingKa: iarc,
      arcingMinKa: iarc * vcf,
      incidentEnergyCal: pick(E600, E2700, E14300) / 4.184,
      arcFlashBoundaryMm: pick(B600, B2700, B14300),
      correctionFactor: cf,
      inRange,
    };
  }

  // 208 V ≤ Voc ≤ 600 V — single 600 V anchor (4.10), Eq 25 for final current.
  const Ia600 = arcCurrentAnchor(ARC[config].v600, Ibf, G);
  const iarc = 1 / Math.sqrt((V * V) / (0.36 * Ia600 * Ia600) - (V * V / 0.36 - 1) / (Ibf * Ibf)); // Eq 25
  const e = IE[config].v600; // Eq 6 uses the 600 V (Table 3) coefficients
  return {
    arcingKa: iarc,
    arcingMinKa: iarc * (1 - 0.5 * varCf(config, V)),
    incidentEnergyCal: energyAnchor(e, T, G, Ibf, iarc, D, cf) / 4.184,
    arcFlashBoundaryMm: afbAnchor(e, T, G, Ibf, iarc, cf),
    correctionFactor: cf,
    inRange,
  };
}
