// =====================================================================
// GE Multilin 869 — Thermal Model (49) dynamic protection element.
//
// Pure module: no React, no store, no solver imports. A time-domain state
// model that integrates stator + rotor heating into a single register,
// Thermal Capacity Used (TCU, 0–100+%), and trips when TCU reaches 100%.
//
// All magic constants are cited from the GE 869 instruction manual,
// chapter 9.2.1.2 "Thermal Model (49)". Where the manual is ambiguous the
// assumption is called out in a comment beginning "ASSUMPTION:".
//
// Scope: the current-based core (Eq 1–4), RTD bias, output/reset/block
// logic and power-loss memory are fully implemented. The voltage-dependent
// acceleration curve is implemented behind a flag but is UNVALIDATED
// (needs manual Figures 169–171). FlexCurves A–D/OL (user custom curves)
// are not implemented — only Standard and IEC characteristics.
// =====================================================================

// GE Standard motor-overload curve coefficients (manual §9.2.1.2.3).
// t_trip = TDM·C0 / ( C2·(m−1)² + C1·(m−1) ),  m = Ieq/FLA (Cutoff).
// Verified against the manual's "Standard Curve TD Multipliers" table to
// four decimals (e.g. m=2 → 29.158 s, m=3 → 10.932 s, m=5 → 3.643 s).
const GE_STD_C0 = 2.2116623;
const GE_STD_C2 = 0.02530337;
const GE_STD_C1 = 0.05054758;
// The Standard table flattens to a constant minimum time for pickup level
// ≥ 8 (locked-rotor region) — m=8,10,15,20 all read 1.39 s ·TDM. We cap the
// effective multiple at 8 to reproduce that floor.
const GE_STD_LOCKED_ROTOR_MULTIPLE = 8;

// GE Standard motor-overload curve, "Cutoff" effect: time to trip (s) at a
// given multiple of FLA. Pure helper shared by the dynamic model and the
// grading-chart TCC curve so both use the identical characteristic.
export function geStandardTripTime(multipleOfFla: number, tdm: number): number {
  if (multipleOfFla <= 1) return Infinity;
  const mc = Math.min(multipleOfFla, GE_STD_LOCKED_ROTOR_MULTIPLE);
  const denom = GE_STD_C2 * (mc - 1) ** 2 + GE_STD_C1 * (mc - 1);
  return (tdm * GE_STD_C0) / denom;
}

export type TripFunction = "Disabled" | "Trip" | "LatchedTrip" | "Configurable";
export type OverloadCurve = "Standard" | "IEC"; // FlexCurves A–D/OL not modelled
export type CurveEffect = "Cutoff" | "Shift";
export type MotorStatus = "STOPPED" | "STARTING" | "RUNNING" | "OVERLOAD" | "TRIPPED";

export interface Relay869ThermalSettings {
  trip_function: TripFunction;       // manual default Disabled
  overload_curve: OverloadCurve;     // default Standard
  curve_effect: CurveEffect;         // default Cutoff (Standard curve only)
  ol: number;                        // overload factor (×FLA); pickup = OL·FLA
  fla: number;                       // motor full-load amps
  td_multiplier: number;             // TDM 1.00–25.00 (Standard) / 0–600 (FlexCurve)
  unbalance_bias_k: number;          // K, integer 0–19 (default 0); K=8 ≈ NEMA derating
  cool_time_const_running_min: number; // default 15
  cool_time_const_stopped_min: number; // default 30
  hot_cold_safe_stall_ratio: number; // 0.01–1.00 (default 1.0)
  // Alarm
  alarm_enabled: boolean;
  alarm_pickup_pct: number;          // default 75
  // IEC overload curve settings (IEC 255-8)
  iec_curve_k_factor: number;        // 1.00–1.50, default 1.10
  iec_time_constant_1_min: number;   // stator-limited (running), default 45
  iec_time_constant_2_min: number;   // rotor-limited (starting). ASSUMPTION: default 45 (manual gives one default; τ2 is usually set lower for rotor heating)
  // RTD bias (optional)
  rtd_bias_enabled: boolean;
  rtd_bias_min_c: number;            // default 40
  rtd_bias_center_c: number;         // default 130
  rtd_bias_max_c: number;            // default 155
  rtd_bias_pickup_delay_s: number;   // default 2
  // Voltage-dependent (optional, experimental)
  vd_enabled: boolean;
  vd_stall_current_min_v: number;    // I1: stall current at min voltage (×FLA)
  vd_stall_time_min_v: number;       // t1: safe stall time at min voltage (s)
  vd_stall_current_100v: number;     // I2: stall current at 100% voltage (×FLA)
  vd_stall_time_100v: number;        // t2: safe stall time at 100% voltage (s)
  vd_min_voltage_pu: number;         // the "min voltage" anchor (pu of nominal)
}

export const DEFAULT_869_THERMAL: Relay869ThermalSettings = {
  trip_function: "Disabled",
  overload_curve: "Standard",
  curve_effect: "Cutoff",
  ol: 1.05,
  fla: 100,
  td_multiplier: 1.0,
  unbalance_bias_k: 0,
  cool_time_const_running_min: 15,
  cool_time_const_stopped_min: 30,
  hot_cold_safe_stall_ratio: 1.0,
  alarm_enabled: false,
  alarm_pickup_pct: 75,
  iec_curve_k_factor: 1.1,
  iec_time_constant_1_min: 45,
  iec_time_constant_2_min: 45,
  rtd_bias_enabled: false,
  rtd_bias_min_c: 40,
  rtd_bias_center_c: 130,
  rtd_bias_max_c: 155,
  rtd_bias_pickup_delay_s: 2,
  vd_enabled: false,
  vd_stall_current_min_v: 6,
  vd_stall_time_min_v: 10,
  vd_stall_current_100v: 6,
  vd_stall_time_100v: 8,
  vd_min_voltage_pu: 0.8,
};

export interface ThermalStepInput {
  dtSeconds: number;        // simulation time step
  ia: number;               // RMS phase currents (A)
  ib: number;
  ic: number;
  i1?: number;              // positive-sequence current (A); if absent, unbalance biasing is off
  i2?: number;              // negative-sequence current (A)
  rtdTempC?: number;        // hottest stator RTD (°C), only if rtd_bias_enabled
  status: MotorStatus;
  block?: boolean;          // FlexLogic block: keep integrating, suppress outputs
  vMag_pu?: number;         // measured terminal voltage (pu of nominal), only for VD module
  vfdNotBypassed?: boolean; // block VD when a VFD distorts the voltage input
}

export interface ThermalStepResult {
  tcu: number;              // operative Thermal Capacity Used (%)
  ieqPu: number;            // Ieq / FLA
  inOverload: boolean;
  tTripS: number | null;    // current time-to-trip estimate (null when not in overload)
  tripOp: boolean;
  alarmOp: boolean;
}

export class Relay869ThermalModel {
  private tcu = 0;          // Thermal Capacity Used register (%)
  private latched = false;  // LatchedTrip output state
  private tripped = false;  // self-resetting trip state (Trip/Configurable, 100/97% hysteresis)
  private ipPu = 0;         // pre-overload load current (×FLA) — Ip for the IEC hot curve
  private rtdOverDelayS = 0; // how long RTD_TCU has been ≥100% (for the pickup delay)

  constructor(public settings: Relay869ThermalSettings = { ...DEFAULT_869_THERMAL }) {}

  /** Current TCU register value (%). */
  get thermalCapacityUsed(): number {
    return this.tcu;
  }

  /** Reset after a trip. Latched trips clear only when not in overload. */
  reset(emergencyRestart = false): void {
    if (this.latched && !emergencyRestart) {
      // Caller must guarantee current < OL·FLA; emergency restart overrides.
      this.latched = false;
    }
    this.tripped = false;
    if (emergencyRestart) {
      this.latched = false;
      this.tcu = 0;
    }
  }

  // ---- Equation 1: equivalent heating current (unbalance biasing) ----
  // Ieq = sqrt( Iavg² · (1 + K·(I2/I1)²) ).  K=0 → Ieq = Iavg.
  equivalentCurrent(input: ThermalStepInput): { ieq: number; ieqPu: number } {
    const iavg = (input.ia + input.ib + input.ic) / 3;
    const k = this.settings.unbalance_bias_k;
    let ratioSq = 0;
    if (k > 0 && input.i1 !== undefined && input.i2 !== undefined && input.i1 > 0) {
      ratioSq = (input.i2 / input.i1) ** 2;
    }
    const ieq = Math.sqrt(iavg * iavg * (1 + k * ratioSq));
    return { ieq, ieqPu: this.settings.fla > 0 ? ieq / this.settings.fla : 0 };
  }

  // ---- Equation 2: time-to-trip on the overload curve ----
  // ieqPu is Ieq/FLA. Returns Infinity when below the curve's asymptote.
  tripTime(ieqPu: number): number {
    if (this.settings.overload_curve === "IEC") return this.iecTripTime(ieqPu);
    return this.standardTripTime(ieqPu);
  }

  private standardTripTime(ieqPu: number): number {
    // Cutoff divides by FLA (asymptote at FLA); Shift divides by OL·FLA
    // (asymptote at the overload pickup) — manual §9.2.1.2.3 / Fig 164.
    const denomRef = this.settings.curve_effect === "Shift" ? this.settings.ol : 1;
    return geStandardTripTime(ieqPu / denomRef, this.settings.td_multiplier);
  }

  private iecTripTime(ieqPu: number): number {
    // IEC 255-8 hot/cold curves (manual §9.2.1.2.4). Currents in ×FLA.
    const k = this.settings.iec_curve_k_factor;
    const ieq = ieqPu;
    const kfla = k; // k·FLA expressed in ×FLA units
    if (ieq <= kfla) return Infinity;

    // τ1 (stator) for k·FLA < Ieq ≤ 2k·FLA; τ2 (rotor) for Ieq > 2k·FLA.
    const tau1 = this.settings.iec_time_constant_1_min * 60;
    const tau2 = this.settings.iec_time_constant_2_min * 60;
    const cold = (tau: number) => tau * Math.log((ieq * ieq) / (ieq * ieq - kfla * kfla));
    const hot = (tau: number) => {
      const ip = this.ipPu;
      return tau * Math.log((ieq * ieq - ip * ip) / (ieq * ieq - kfla * kfla));
    };
    const useHot = this.tcu >= 5 || this.ipPu > 0;
    const f = useHot ? hot : cold;

    // ASSUMPTION: across the τ1/τ2 discontinuity at 2k·FLA, use the LONGER of
    // the two candidate trip times (per the prompt) to avoid nuisance trips.
    const boundary = 2 * kfla;
    const inBand = ieq > boundary * 0.95 && ieq < boundary * 1.05;
    if (inBand) return Math.max(f(tau1), f(tau2));
    return ieq > boundary ? f(tau2) : f(tau1);
  }

  // ---- RTD bias: a parallel TCU estimate from stator temperature ----
  private rtdTcu(tempC: number): number {
    const s = this.settings;
    if (tempC < s.rtd_bias_min_c) return 0;
    if (tempC >= s.rtd_bias_max_c) return 100;
    const tcuAtCenter = (1 - s.hot_cold_safe_stall_ratio) * 100;
    if (tempC < s.rtd_bias_center_c) {
      return ((tempC - s.rtd_bias_min_c) / (s.rtd_bias_center_c - s.rtd_bias_min_c)) * tcuAtCenter;
    }
    return (
      ((tempC - s.rtd_bias_center_c) / (s.rtd_bias_max_c - s.rtd_bias_center_c)) *
        (100 - tcuAtCenter) +
      tcuAtCenter
    );
  }

  // ---- Voltage-dependent acceleration curve (EXPERIMENTAL, unvalidated) ----
  // Reshapes the time-to-trip during a start based on terminal voltage.
  // t = A·exp(−I/σ); σ and A interpolated between the min-voltage and 100%
  // anchors. Clamped at the 8× value. Returns null when the feature does not
  // apply (so the caller falls back to the thermal curve).
  private vdTripTime(ieqPu: number, vMagPu: number): number | null {
    const s = this.settings;
    if (!s.vd_enabled) return null;
    // σ = (I1 − I2)/ln(t2/t1); A = t1·exp(I1/σ)  — manual §9.2.1.2.12 (Fig 169-171).
    const sigmaAt = (i1: number, t1: number, i2: number, t2: number) => (i1 - i2) / Math.log(t2 / t1);
    const curve = (i1: number, t1: number, sigma: number, I: number) => {
      const A = t1 * Math.exp(i1 / sigma);
      return A * Math.exp(-Math.min(I, GE_STD_LOCKED_ROTOR_MULTIPLE) / sigma);
    };
    const sMin = sigmaAt(s.vd_stall_current_min_v, s.vd_stall_time_min_v, s.vd_stall_current_100v, s.vd_stall_time_100v);
    const tMinV = curve(s.vd_stall_current_min_v, s.vd_stall_time_min_v, sMin, ieqPu);
    const t100 = curve(s.vd_stall_current_100v, s.vd_stall_time_100v, sMin, ieqPu);
    // Linear interpolation on voltage between the min-voltage and 100% anchors.
    const frac = Math.min(1, Math.max(0, (vMagPu - s.vd_min_voltage_pu) / (1 - s.vd_min_voltage_pu)));
    return tMinV + frac * (t100 - tMinV);
  }

  // ---- The per-step update (Eq 3 heating, Eq 4 cooling, outputs) ----
  step(input: ThermalStepInput): ThermalStepResult {
    const s = this.settings;
    const dt = input.dtSeconds;
    const { ieqPu } = this.equivalentCurrent(input);
    const inOverload = ieqPu > s.ol; // pickup = OL·FLA → threshold OL in ×FLA units

    let tTrip: number | null = null;

    if (inOverload) {
      // Optional voltage-dependent reshaping during a start (else thermal curve).
      const vd =
        s.vd_enabled && !input.vfdNotBypassed && input.vMag_pu !== undefined
          ? this.vdTripTime(ieqPu, input.vMag_pu)
          : null;
      tTrip = vd ?? this.tripTime(ieqPu);
      // Eq 3: per-cycle accumulation collapses to ΔTCU = 100·dt/t_trip
      // (the T_system cancels: TCU reaches 100% after t_trip s of overload).
      if (isFinite(tTrip) && tTrip > 0) this.tcu += (100 * dt) / tTrip;
    } else {
      // Eq 4: exponential cooling toward a load-dependent floor (running) or
      // zero (stopped). τ_cool in minutes → convert dt to minutes.
      const stopped = input.status === "STOPPED" || input.status === "TRIPPED";
      const tauCoolMin = stopped ? s.cool_time_const_stopped_min : s.cool_time_const_running_min;
      const tcuEnd = stopped ? 0 : (ieqPu / s.ol) * (1 - s.hot_cold_safe_stall_ratio) * 100;
      const dtMin = dt / 60;
      this.tcu = tcuEnd + (this.tcu - tcuEnd) * Math.exp(-dtMin / (tauCoolMin || 1e9));
      this.ipPu = ieqPu; // remember pre-overload load for the IEC hot curve
    }

    // RTD bias: operative TCU = max(current-based, RTD-based). RTD alone
    // cannot trip — it must coincide with an overload and persist for the
    // pickup delay.
    let rtdTripReady = false;
    if (s.rtd_bias_enabled && input.rtdTempC !== undefined) {
      const rtd = this.rtdTcu(input.rtdTempC);
      if (rtd >= this.tcu) this.tcu = rtd; // operative from this point onward
      if (rtd >= 100) {
        this.rtdOverDelayS += dt;
        rtdTripReady = this.rtdOverDelayS >= s.rtd_bias_pickup_delay_s;
      } else {
        this.rtdOverDelayS = 0;
      }
    }

    // ---- Output operands + reset logic ----
    const enabled = s.trip_function !== "Disabled";
    // Current-based trip needs TCU ≥ 100; an RTD-only trip additionally needs
    // to be in overload and past the pickup delay.
    const tcuTrip = this.tcu >= 100 && (inOverload || !s.rtd_bias_enabled);
    const rtdTrip = rtdTripReady && inOverload;

    if (enabled && (tcuTrip || rtdTrip)) {
      this.tripped = true;
      if (s.trip_function === "LatchedTrip") this.latched = true;
    }
    // Self-reset (Trip/Configurable): trip clears when TCU falls to 97%.
    if (s.trip_function !== "LatchedTrip" && this.tcu <= 97) this.tripped = false;

    let tripOp = enabled && (this.latched || this.tripped);
    let alarmOp = enabled && s.alarm_enabled && this.tcu >= s.alarm_pickup_pct;

    // BLOCK: keep integrating thermal memory (done above) but suppress outputs.
    if (input.block) {
      tripOp = false;
      alarmOp = false;
    }

    return { tcu: this.tcu, ieqPu, inOverload, tTripS: tTrip, tripOp, alarmOp };
  }

  // ---- Power-loss / memory behavior (manual §9.2.1.2) ----
  // Call once when control power is restored after an outage.
  applyControlPowerOutage(opts: {
    durationMin: number;
    statusAtLoss: MotorStatus;
    clockReliable: boolean;
  }): void {
    if (!opts.clockReliable) return; // TCU unchanged when the RTC is unreliable
    const running = opts.statusAtLoss === "RUNNING" || opts.statusAtLoss === "OVERLOAD";
    if (running) return; // TCU unchanged across the outage
    // Stopped/tripped at loss → decay toward zero at the stopped cooling rate.
    const tau = this.settings.cool_time_const_stopped_min || 1e9;
    this.tcu = this.tcu * Math.exp(-opts.durationMin / tau);
  }
}
