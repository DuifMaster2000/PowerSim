import { describe, test, expect } from "vitest";
import { buildNetwork } from "./network";
import { runLoadFlow } from "./loadFlow";
import { EXAMPLES } from "../examples";
import type { ProjectFile } from "../types";

const file = (id: string): ProjectFile => {
  const ex = EXAMPLES.find((e) => e.id === id);
  if (!ex) throw new Error(`example ${id} not found`);
  return ex.file;
};

// Look up a converged bus voltage (pu) by the bus label.
function vpu(id: string, busLabel: string): number {
  const lf = runLoadFlow(buildNetwork(file(id)));
  const b = lf.buses.find((x) => x.label === busLabel);
  if (!b) throw new Error(`bus ${busLabel} not found in ${id}`);
  return b.voltagePu;
}

describe("load flow — invariants on every example", () => {
  for (const ex of EXAMPLES) {
    test(`${ex.id} converges with a flat 1.0 pu slack and sane voltages`, () => {
      const net = buildNetwork(ex.file);
      const lf = runLoadFlow(net);
      expect(lf.converged).toBe(true);
      expect(lf.iterations).toBeGreaterThan(0);
      // Slack bus is held at exactly 1.0 pu.
      expect(lf.buses[net.slackBusIndex].voltagePu).toBeCloseTo(1.0, 9);
      // All bus voltages land in a believable operating band.
      for (const b of lf.buses) {
        expect(b.voltagePu).toBeGreaterThan(0.9);
        expect(b.voltagePu).toBeLessThanOrEqual(1.05);
      }
    });
  }
});

// Regression baselines — captured from the solver and locked in so any future
// change that shifts a converged voltage is flagged. Tolerance 1e-3 pu.
describe("load flow — voltage baselines", () => {
  test("grid intake 132/33", () => {
    expect(vpu("grid-intake-132-33", "BB-33")).toBeCloseTo(0.9816, 3);
    expect(vpu("grid-intake-132-33", "TOWN-FDR node")).toBeCloseTo(0.9785, 3);
  });
  test("primary substation 33/11", () => {
    expect(vpu("primary-substation-33-11", "BB-11")).toBeCloseTo(0.9857, 3);
    expect(vpu("primary-substation-33-11", "FDR1-LOAD node")).toBeCloseTo(0.9757, 3);
  });
  test("motor feeder 11/6.6", () => {
    expect(vpu("motor-feeder-66", "BB-6.6")).toBeCloseTo(0.9806, 3);
  });
  test("ring main 33 (PV bus holds 1.0)", () => {
    expect(vpu("ring-main-33", "BUS-B")).toBeCloseTo(0.9934, 3);
    expect(vpu("ring-main-33", "BUS-C")).toBeCloseTo(1.0, 3);
  });
  test("full plant 132→525", () => {
    expect(vpu("full-plant-132-525", "BB-33")).toBeCloseTo(0.9937, 3);
    expect(vpu("full-plant-132-525", "BB-11")).toBeCloseTo(0.9831, 3);
    expect(vpu("full-plant-132-525", "BB-6.6")).toBeCloseTo(0.968, 3);
    expect(vpu("full-plant-132-525", "BB-525V")).toBeCloseTo(0.9707, 3);
  });
});

describe("load flow — error handling", () => {
  const base = { version: "1.0" as const, metadata: { name: "t", created: "", modified: "" }, system: { base_mva: 10, frequency_hz: 50 } };

  test("reports the missing slack when there is no grid source", () => {
    const proj: ProjectFile = {
      ...base,
      components: [{ id: "BB-1", type: "busbar", label: "BB", position: { x: 0, y: 0 }, parameters: { nominal_voltage_kv: 11, length_px: 200 } }],
      connections: [],
    };
    const lf = runLoadFlow(buildNetwork(proj));
    expect(lf.converged).toBe(false);
    expect(lf.message).toMatch(/slack/i);
  });

  test("reports an empty network", () => {
    const proj: ProjectFile = { ...base, components: [], connections: [] };
    const lf = runLoadFlow(buildNetwork(proj));
    expect(lf.converged).toBe(false);
    expect(lf.buses).toHaveLength(0);
  });
});
