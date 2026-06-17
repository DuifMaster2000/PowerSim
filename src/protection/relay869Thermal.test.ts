import { describe, test, expect } from "vitest";
import { geStandardTripTime } from "./relay869Thermal";

// The GE Multilin 869 "Standard" overload curve, validated against the
// manual's TD-Multiplier table (TDM = 1). These exact coefficients are the
// single source of truth shared with the grading chart's thermal curve.
describe("GE 869 standard curve — manual table (TDM = 1)", () => {
  const table: Array<[number, number]> = [
    [2.0, 29.16],
    [3.0, 10.93],
    [5.0, 3.64],
  ];
  for (const [mult, expected] of table) {
    test(`${mult.toFixed(1)}×FLA → ${expected} s`, () => {
      const t = geStandardTripTime(mult, 1);
      expect(Math.abs(t - expected) / expected).toBeLessThan(0.01);
    });
  }

  test("the TD multiplier scales the trip time linearly", () => {
    expect(geStandardTripTime(3, 4) / geStandardTripTime(3, 1)).toBeCloseTo(4, 6);
  });
});
