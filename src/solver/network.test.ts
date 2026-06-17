import { describe, test, expect } from "vitest";
import { buildNetwork, effectiveStartingCurrentRatio } from "./network";
import { EXAMPLES } from "../examples";

const byId = (id: string) => {
  const ex = EXAMPLES.find((e) => e.id === id);
  if (!ex) throw new Error(`example ${id} not found`);
  return ex.file;
};

describe("effectiveStartingCurrentRatio", () => {
  test("DOL draws the full locked-rotor current", () => {
    expect(effectiveStartingCurrentRatio("DOL", 6)).toBe(6);
  });
  test("star-delta draws one third", () => {
    expect(effectiveStartingCurrentRatio("star-delta", 6)).toBe(2);
  });
  test("soft-starter is capped at 3.5× (but never above LRC)", () => {
    expect(effectiveStartingCurrentRatio("soft-starter", 6)).toBe(3.5);
    expect(effectiveStartingCurrentRatio("soft-starter", 3)).toBe(3);
  });
  test("VFD presents ~1.1× to the supply", () => {
    expect(effectiveStartingCurrentRatio("VFD", 6)).toBeCloseTo(1.1, 10);
  });
});

describe("buildNetwork — topology", () => {
  test("closed breakers are absorbed into the bus (not branches)", () => {
    // Grid intake: SRC → breaker → BB-132 → TX → BB-33 → cable → load.
    // Only the transformer and cable are branches; the breaker is not.
    const net = buildNetwork(byId("grid-intake-132-33"));
    expect(net.branches).toHaveLength(2);
    expect(net.branches.map((b) => b.componentType).sort()).toEqual(["cable", "transformer"]);
    // The source sits on the slack bus, which is the 132 kV busbar.
    expect(net.slackBusIndex).toBe(0);
    expect(net.buses[net.slackBusIndex].baseKv).toBe(132);
    expect(net.buses[net.slackBusIndex].busType).toBe("slack");
  });

  test("base kV propagates through every transformer in the full plant", () => {
    const net = buildNetwork(byId("full-plant-132-525"));
    const levels = new Set(net.buses.map((b) => Math.round(b.baseKv * 1000) / 1000));
    expect(levels.has(132)).toBe(true);
    expect(levels.has(33)).toBe(true);
    expect(levels.has(11)).toBe(true);
    expect(levels.has(6.6)).toBe(true);
    expect(levels.has(0.525)).toBe(true);
    // No reachable bus should be left at the un-propagated 0 kV sentinel.
    expect(net.buses.every((b) => b.baseKv > 0)).toBe(true);
  });

  test("a second grid source becomes a PV bus", () => {
    const net = buildNetwork(byId("ring-main-33"));
    expect(net.sources).toHaveLength(2);
    const pvCount = net.buses.filter((b) => b.busType === "pv").length;
    expect(pvCount).toBe(1);
    // The embedded generator schedules 20 MW on a 100 MVA base → 0.2 pu.
    const pv = net.buses.find((b) => b.busType === "pv");
    expect(pv?.pvScheduledPu).toBeCloseTo(0.2, 10);
  });

  test("relay control wires never appear as branches or buses", () => {
    // The motor feeder has two relays wired to breakers over control wires.
    const net = buildNetwork(byId("motor-feeder-66"));
    // 3 electrical buses (BB-11, BB-6.6, motor node) — relays add none.
    expect(net.buses).toHaveLength(3);
    expect(net.branches.every((b) => b.componentType !== "switch")).toBe(true);
  });
});
