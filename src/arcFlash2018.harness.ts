// =====================================================================
// Validation harness for the IEEE 1584-2018 engine, checked against the
// standard's Annex D worked example (D.1 — medium-voltage VCB system).
//   npx tsx src/arcFlash2018.harness.ts
// =====================================================================

import { computeArcFlash2018 } from "./arcFlash2018";

const ok = (got: number, want: number, tol: number, label: string) => {
  const pass = Math.abs(got - want) <= tol;
  console.log(`  ${pass ? "✓" : "✗"} ${label}: got ${got.toFixed(3)}  expect ${want}  (±${tol})`);
  return pass;
};

console.log("IEEE 1584-2018 — Annex D.1 (VCB, 4.16 kV, 15 kA, gap 104 mm, D 914.4 mm, box 1143×762, T 197 ms)\n");

const r = computeArcFlash2018({
  config: "VCB",
  voltageKv: 4.16,
  boltedKa: 15,
  gapMm: 104,
  workingDistanceMm: 914.4,
  clearingTimeS: 0.197,
  enclosureWidthMm: 762,
  enclosureHeightMm: 1143,
  shallow: false,
});

let all = true;
all = ok(r.correctionFactor, 1.284, 0.002, "Enclosure correction CF (D.22)") && all;
all = ok(r.arcingKa, 12.979, 0.01, "Final arcing current Iarc (D.17)") && all;
all = ok(r.incidentEnergyCal * 4.184, 12.152, 0.02, "Final incident energy E [J/cm²] (D.32)") && all;
all = ok(r.arcFlashBoundaryMm, 1606, 3, "Final arc-flash boundary AFB [mm] (D.42)") && all;

console.log(`\n  Incident energy = ${r.incidentEnergyCal.toFixed(2)} cal/cm²   (${(r.incidentEnergyCal * 4.184).toFixed(2)} J/cm²)`);
console.log(`\n${all ? "✅ ALL ANNEX D VALUES MATCH" : "❌ MISMATCH — check coefficients/equations"}`);
