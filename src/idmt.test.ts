import { describe, test, expect } from "vitest";
import { idmtOperateTime, primaryPickupA } from "./idmt";
import { DEFAULT_PARAMS } from "./defaults";
import type { RelayParams, CtParams } from "./types";

const ct: CtParams = { primary_a: 100, secondary_a: 1 };
// Base relay: plug 1.0 on a 100 A CT → pickup 100 A. Stages 2/3 off.
const relay = (over: Partial<RelayParams>): RelayParams => ({ ...DEFAULT_PARAMS.relay, plug_setting: 1.0, ...over });

describe("primaryPickupA", () => {
  test("scales the plug setting by the CT primary rating", () => {
    expect(primaryPickupA(relay({ plug_setting: 1.25 }), ct)).toBe(125);
  });
  test("falls back to a 100 A primary when no CT is fitted", () => {
    expect(primaryPickupA(relay({ plug_setting: 1.0 }), null)).toBe(100);
  });
});

describe("idmtOperateTime — single stage", () => {
  test("IEC Standard Inverse, TMS 1, at 2× pickup ≈ 10.03 s", () => {
    // t = TMS·0.14 / (m^0.02 − 1) with m = 2.
    const t = idmtOperateTime(relay({ curve: "IEC-SI", time_multiplier: 1 }), ct, 200);
    expect(t).toBeCloseTo(10.029, 2);
  });

  test("IEEE Moderately Inverse, TDM 1, at 2× pickup ≈ 3.80 s", () => {
    const t = idmtOperateTime(relay({ curve: "IEEE-MI", time_multiplier: 1 }), ct, 200);
    expect(t).toBeCloseTo(3.803, 2);
  });

  test("ABB RI inverse flattens toward ~2.95·TMS at high multiples", () => {
    // t = TMS / (0.339 − 0.236/m); at m = 20 → ≈ 3.056 s.
    const t = idmtOperateTime(relay({ curve: "ABB-RI", time_multiplier: 1 }), ct, 2000);
    expect(t).toBeCloseTo(3.056, 2);
  });

  test("definite time returns the set delay regardless of current", () => {
    const r = relay({ curve: "DT", definite_time_s: 0.42 });
    expect(idmtOperateTime(r, ct, 500)).toBe(0.42);
    expect(idmtOperateTime(r, ct, 5000)).toBe(0.42);
  });

  test("returns Infinity below pickup", () => {
    expect(idmtOperateTime(relay({ curve: "IEC-SI", time_multiplier: 1 }), ct, 90)).toBe(Infinity);
  });
});

describe("idmtOperateTime — multi-stage", () => {
  test("a fast instantaneous stage wins over the slow low stage", () => {
    // Stage 1: slow SI (≈2.5 s at 15×). Stage 3: instantaneous DT at 0.05 s,
    // pickup 10× (1000 A). At 1500 A both pick up → relay trips on the fastest.
    const r = relay({
      curve: "IEC-SI", time_multiplier: 1,
      stage3_enabled: true, stage3_pickup: 10, stage3_time_s: 0.05,
    });
    expect(idmtOperateTime(r, ct, 1500)).toBeCloseTo(0.05, 6);
  });
});
