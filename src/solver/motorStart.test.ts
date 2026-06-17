import { describe, test, expect } from "vitest";
import { runMotorStarting } from "./motorStart";
import { EXAMPLES } from "../examples";
import type { ProjectFile } from "../types";

const file = (id: string): ProjectFile => {
  const ex = EXAMPLES.find((e) => e.id === id);
  if (!ex) throw new Error(`example ${id} not found`);
  return ex.file;
};

describe("motor starting — DOL motor on the 6.6 kV feeder", () => {
  const r = runMotorStarting(file("motor-feeder-66"), "M-1");

  test("converges and uses the full locked-rotor ratio for DOL", () => {
    expect(r.converged).toBe(true);
    expect(r.effectiveStartingCurrentRatio).toBe(6);
  });

  test("terminal voltage and bus dip match the baseline", () => {
    expect(r.terminalVoltagePu).toBeCloseTo(0.8508, 3);
    expect(r.fullLoadCurrentA).toBeCloseTo(261.6, 1);
    const dip = r.busDips.find((d) => d.busId === r.motorBusId);
    expect(dip?.dipPercent).toBeCloseTo(12.94, 1);
  });

  test("locked rotor is modelled as constant impedance: I ≈ LRC·FLC·V", () => {
    // A stalled rotor is a fixed admittance, so the drawn current scales with
    // the depressed terminal voltage rather than staying at the full 6×FLC.
    const expected = r.effectiveStartingCurrentRatio * r.fullLoadCurrentA * r.terminalVoltagePu;
    expect(r.startingCurrentA).toBeCloseTo(expected, 0);
  });
});

describe("motor starting — baselines across the full plant", () => {
  test("6.6 kV motor causes a deep dip (DOL on an 8 MVA transformer)", () => {
    const r = runMotorStarting(file("full-plant-132-525"), "M-1");
    expect(r.terminalVoltagePu).toBeCloseTo(0.7598, 3);
    const dip = r.busDips.find((d) => d.busId === r.motorBusId);
    expect(dip?.dipPercent).toBeCloseTo(21.24, 1);
  });

  test("525 V motor start", () => {
    const r = runMotorStarting(file("full-plant-132-525"), "M-2");
    expect(r.terminalVoltagePu).toBeCloseTo(0.8231, 3);
    expect(r.fullLoadCurrentA).toBeCloseTo(343.7, 1);
  });
});
