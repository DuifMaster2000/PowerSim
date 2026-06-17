import { describe, test, expect } from "vitest";
import { buildNetwork } from "./network";
import { runShortCircuit } from "./shortCircuit";
import { EXAMPLES } from "../examples";
import type { ProjectFile } from "../types";

const file = (id: string): ProjectFile => {
  const ex = EXAMPLES.find((e) => e.id === id);
  if (!ex) throw new Error(`example ${id} not found`);
  return ex.file;
};

// Fault a bus (by label) and return I_k" in kA at the given voltage factor.
function ik(id: string, busLabel: string, c = 1.1): number {
  const net = buildNetwork(file(id));
  const idx = net.buses.findIndex((b) => b.label === busLabel);
  if (idx < 0) throw new Error(`bus ${busLabel} not found in ${id}`);
  return runShortCircuit(net, idx, c).ikSymKa;
}

describe("short circuit — exact physics on a source-only bus", () => {
  // A grid source feeding a single busbar: the fault at that bus sees only the
  // source impedance, so I_k" = c · S_sc / (√3 · kV) — independent of MVA base.
  const proj: ProjectFile = {
    version: "1.0",
    metadata: { name: "src", created: "", modified: "" },
    system: { base_mva: 10, frequency_hz: 50 },
    components: [
      { id: "SRC", type: "grid_source", label: "G", position: { x: 0, y: 0 }, parameters: { nominal_voltage_kv: 11, short_circuit_mva: 500, xr_ratio: 10, scheduled_mw: 0 } },
      { id: "BB", type: "busbar", label: "B", position: { x: 0, y: 0 }, parameters: { nominal_voltage_kv: 11, length_px: 200 } },
    ],
    connections: [{ id: "c1", fromComponent: "SRC", fromTerminal: "out", toComponent: "BB", toTerminal: "top" }],
  };

  test("matches c·S_sc/(√3·kV)", () => {
    const net = buildNetwork(proj);
    const sc = runShortCircuit(net, 0, 1.1);
    expect(sc.ikSymKa).toBeCloseTo((1.1 * 500) / (Math.sqrt(3) * 11), 3); // 28.868 kA
  });

  test("the voltage factor scales the fault current linearly", () => {
    const net = buildNetwork(proj);
    const hi = runShortCircuit(net, 0, 1.1).ikSymKa;
    const lo = runShortCircuit(net, 0, 1.05).ikSymKa;
    expect(lo / hi).toBeCloseTo(1.05 / 1.1, 6);
  });

  test("peak current i_p exceeds I_k\" by a κ·√2 factor", () => {
    const sc = runShortCircuit(buildNetwork(proj), 0, 1.1);
    const ratio = sc.ipPeakKa / sc.ikSymKa;
    // κ ∈ (1.02, 2] → ratio = κ·√2 ∈ (1.44, 2.83].
    expect(ratio).toBeGreaterThan(1.44);
    expect(ratio).toBeLessThanOrEqual(2.83);
  });
});

// Regression baselines (c = 1.10), captured from the solver with the IEC 60909
// transformer K_T correction applied. Source-bus values have no transformer in
// the fault path, so K_T does not touch them and they stay exact hand-checks:
// e.g. 132 kV intake = 1.1·3500/(√3·132) = 16.84 kA.
describe("short circuit — fault-level baselines", () => {
  test("grid intake 132/33", () => {
    expect(ik("grid-intake-132-33", "BB-132")).toBeCloseTo(16.84, 2); // source bus — no K_T
    expect(ik("grid-intake-132-33", "BB-33")).toBeCloseTo(5.9947, 2); // behind a 12% TX (K_T<1 → higher)
  });
  test("primary substation 33/11", () => {
    expect(ik("primary-substation-33-11", "BB-33")).toBeCloseTo(28.87, 2); // source bus — no K_T
    expect(ik("primary-substation-33-11", "BB-11")).toBeCloseTo(10.3164, 2); // behind a 10% TX
  });
  test("motor feeder 11/6.6 (motor adds to the bus fault level)", () => {
    expect(ik("motor-feeder-66", "BB-6.6")).toBeCloseTo(10.6276, 2); // behind a 7% TX (K_T>1 → lower)
  });
  test("ring main 33 (no transformers → K_T does not apply)", () => {
    expect(ik("ring-main-33", "BUS-A")).toBeCloseTo(48.0, 1);
    expect(ik("ring-main-33", "BUS-C")).toBeCloseTo(34.01, 2);
  });
  test("full plant — all the way down to 525 V", () => {
    expect(ik("full-plant-132-525", "BB-132")).toBeCloseTo(16.91, 2); // source bus — no K_T
    expect(ik("full-plant-132-525", "BB-525V")).toBeCloseTo(34.414, 2);
  });
});
