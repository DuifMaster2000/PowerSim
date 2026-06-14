// =====================================================================
// Arc-flash incident-energy model — IEEE 1584-2002 ("empirically derived").
//
// Pure module: no React, no store, no solver imports. Given the bolted
// three-phase fault current at a bus, the equipment geometry and the
// protection clearing time, it returns the arcing current, incident energy
// (cal/cm²), arc-flash boundary and an NFPA 70E PPE category.
//
// This is the 2002 edition (tractable + widely taught). The 2018 edition is
// more accurate (electrode-configuration models, enclosure-size correction)
// — a documented future refinement. Coefficients below are cited to IEEE
// 1584-2002 §5 (equations) and Table 4 (gaps / distance exponents).
// =====================================================================

export interface EquipmentType {
  label: string;
}

// Equipment classes (IEEE 1584-2002 Table 4). The conductor gap and distance
// exponent depend on BOTH the class and the voltage band — see resolveEquipment.
export const EQUIPMENT_TYPES: Record<string, EquipmentType> = {
  switchgear: { label: "Switchgear" },
  mcc_panel: { label: "MCC / panelboard" },
  cable: { label: "Cable" },
  open_air: { label: "Open-air conductors" },
};

export const DEFAULT_EQUIPMENT_TYPE = "switchgear";

// Map any (possibly legacy) class key to one of the four equipment types.
function normaliseType(key: string): string {
  if (key.startsWith("switchgear")) return "switchgear";
  if (key.startsWith("mcc")) return "mcc_panel";
  if (key.startsWith("cable")) return "cable";
  if (key.startsWith("open")) return "open_air";
  return DEFAULT_EQUIPMENT_TYPE;
}

export interface ResolvedEquipment {
  typeLabel: string;
  bandLabel: string;
  gapMm: number;
  distanceExponent: number;  // x
  workingDistanceMm: number; // D
  openAir: boolean;
  inRange: boolean;          // false above 15 kV (outside IEEE 1584-2002 validity)
}

// Resolve the conductor gap, distance exponent and working distance from the
// equipment class AND the bus voltage band — IEEE 1584-2002 Table 4. The
// empirical model is only valid 0.208–15 kV; above 15 kV the highest-band
// factors are used but inRange is false (the Lee method is the correct tool).
export function resolveEquipment(typeKey: string, voltageKv: number): ResolvedEquipment {
  const type = normaliseType(typeKey);
  const inRange = voltageKv <= 15;
  // Band: ≤1 kV / >1–5 kV / >5–15 kV (and >15 kV reuses the top band, flagged).
  const band: "lv" | "mv5" | "mv15" = voltageKv <= 1 ? "lv" : voltageKv <= 5 ? "mv5" : "mv15";
  const bandLabel = band === "lv" ? "≤1 kV" : band === "mv5" ? ">1–5 kV"
    : inRange ? ">5–15 kV" : ">15 kV — outside IEEE 1584 range";

  // [gapMm, x, workingDistanceMm] per type × band (Table 4). MCC and cable are
  // single-gap classes (predominantly LV); switchgear/open-air vary by band.
  const t = (gapMm: number, x: number, wd: number, openAir = false): ResolvedEquipment => ({
    typeLabel: EQUIPMENT_TYPES[type].label, bandLabel, gapMm, distanceExponent: x, workingDistanceMm: wd, openAir, inRange,
  });
  if (type === "cable") return t(13, 2.0, 455);
  if (type === "mcc_panel") return t(25, 1.641, 455);
  if (type === "open_air") {
    if (band === "lv") return t(10, 2.0, 610, true);
    if (band === "mv5") return t(40, 2.0, 910, true);
    return t(95, 2.0, 910, true);
  }
  // switchgear
  if (band === "lv") return t(32, 1.473, 610);
  if (band === "mv5") return t(104, 0.973, 910);
  return t(152, 0.973, 910);
}

const lg = (x: number) => Math.log10(x);

// IEEE 1584-2002 Eq 1 (V < 1 kV) / Eq 2 (V ≥ 1 kV). Currents in kA, V in kV,
// gap in mm. Returns the arcing current (kA).
export function arcingCurrentKa(boltedKa: number, voltageKv: number, openAir: boolean, gapMm: number): number {
  if (boltedKa <= 0 || voltageKv <= 0) return 0;
  const lgIbf = lg(boltedKa);
  let lgIa: number;
  if (voltageKv < 1) {
    const k = openAir ? -0.153 : -0.097; // Eq 1 config constant
    lgIa = k + 0.662 * lgIbf + 0.0966 * voltageKv + 0.000526 * gapMm
      + 0.5588 * voltageKv * lgIbf - 0.00304 * gapMm * lgIbf;
  } else {
    // Eq 2 — above 1 kV the arcing current is independent of config/gap.
    lgIa = 0.00402 + 0.983 * lgIbf;
  }
  return Math.pow(10, lgIa);
}

// Normalized incident energy En (J/cm² at 0.2 s, 610 mm) — IEEE 1584-2002 Eq 3.
function normalizedEnergy(arcingKa: number, openAir: boolean, grounded: boolean, gapMm: number): number {
  const k1 = openAir ? -0.792 : -0.555;   // config
  const k2 = grounded ? -0.113 : 0;        // grounding
  return Math.pow(10, k1 + k2 + 1.081 * lg(arcingKa) + 0.0011 * gapMm);
}

export interface IncidentEnergyInput {
  boltedKa: number;
  arcingKa: number;
  voltageKv: number;
  openAir: boolean;
  grounded: boolean;
  gapMm: number;
  distanceExponent: number;  // x
  workingDistanceMm: number; // D
  clearingTimeS: number;     // arc duration t
}

// Incident energy (cal/cm²) at the working distance — IEEE 1584-2002 Eq 4/5.
// E[J/cm²] = 4.184·Cf·En·(t/0.2)·(610^x / D^x); cal/cm² = E/4.184, so the
// 4.184 cancels: cal/cm² = Cf·En·(t/0.2)·(610/D)^x.
export function incidentEnergyCal(i: IncidentEnergyInput): number {
  if (i.arcingKa <= 0) return 0;
  const cf = i.voltageKv <= 1 ? 1.5 : 1.0; // calculation factor
  const en = normalizedEnergy(i.arcingKa, i.openAir, i.grounded, i.gapMm);
  return cf * en * (i.clearingTimeS / 0.2) * Math.pow(610 / i.workingDistanceMm, i.distanceExponent);
}

// Arc-flash boundary (mm) — the distance at which incident energy falls to
// 1.2 cal/cm² (onset of a second-degree burn). IEEE 1584-2002 Eq 6.
export function arcFlashBoundaryMm(i: IncidentEnergyInput): number {
  if (i.arcingKa <= 0) return 0;
  const cf = i.voltageKv <= 1 ? 1.5 : 1.0;
  const en = normalizedEnergy(i.arcingKa, i.openAir, i.grounded, i.gapMm);
  const numer = cf * en * (i.clearingTimeS / 0.2);
  return 610 * Math.pow(numer / 1.2, 1 / i.distanceExponent);
}

export interface PpeRating {
  category: number | null; // NFPA 70E PPE category, or null below 1.2 / above 40
  label: string;
  tone: "ok" | "warn" | "bad";
}

// NFPA 70E arc-flash PPE category from incident energy (cal/cm²).
export function ppeRating(cal: number): PpeRating {
  if (cal < 1.2) return { category: null, label: "Below 1.2 — minimal", tone: "ok" };
  if (cal <= 4) return { category: 1, label: "PPE Category 1", tone: "warn" };
  if (cal <= 8) return { category: 2, label: "PPE Category 2", tone: "warn" };
  if (cal <= 25) return { category: 3, label: "PPE Category 3", tone: "bad" };
  if (cal <= 40) return { category: 4, label: "PPE Category 4", tone: "bad" };
  return { category: null, label: "DANGER > 40 — no safe PPE; de-energize", tone: "bad" };
}
