import { describe, test, expect } from "vitest";
import { computeArcFlash2018 } from "./arcFlash2018";

// Validated against IEEE 1584-2018 Annex D.1 — the standard's own worked
// example (VCB, 4.16 kV, 15 kA bolted, 104 mm gap, 914.4 mm working distance,
// 1143×762 mm enclosure, 197 ms clearing).
describe("IEEE 1584-2018 — Annex D.1 worked example", () => {
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

  test("enclosure size correction factor CF (D.22)", () => {
    expect(r.correctionFactor).toBeCloseTo(1.284, 2);
  });
  test("final arcing current Iarc (D.17)", () => {
    expect(r.arcingKa).toBeCloseTo(12.979, 2);
  });
  test("incident energy E (D.32)", () => {
    expect(r.incidentEnergyCal * 4.184).toBeCloseTo(12.152, 1);
  });
  test("arc-flash boundary AFB (D.42)", () => {
    expect(r.arcFlashBoundaryMm).toBeCloseTo(1606, 0);
  });
});
