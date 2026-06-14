// =====================================================================
// Default parameter values when a new component is dropped on the canvas.
// =====================================================================

import type { ComponentType, ParamsByType, MotorStartingMethod, IdmtCurve, CtParams, RelayModel } from "./types";

// Per-model relay setting ranges and available curves — mirrors what the real
// device accepts so the properties panel can't be set outside the hardware.
export interface RelayModelSpec {
  label: string;
  plugMin: number;
  plugMax: number;
  plugStep: number;
  tmsMin: number;
  tmsMax: number;
  dtMin: number;
  dtMax: number;
  curves: IdmtCurve[];
  // 1 = single IDMT stage; 3 = low + high + instantaneous (3I> / 3I>> / 3I>>>)
  stages: 1 | 3;
}

export const RELAY_MODELS: Record<RelayModel, RelayModelSpec> = {
  // Conservative classic-IDMT ranges (electromechanical-era TMS dial).
  generic: {
    label: "Generic IDMT",
    plugMin: 0.1, plugMax: 5, plugStep: 0.05,
    tmsMin: 0.025, tmsMax: 1.5,
    dtMin: 0.01, dtMax: 100,
    curves: ["IEC-SI", "IEC-VI", "IEC-EI", "IEC-LTI", "DT"],
    stages: 1,
  },
  // ABB Relion 615 series, phase overcurrent stages:
  //   3I>   PHLPTOC  start 0.05–5.00 ×In, TMS 0.05–15.0, DT 0.04–200 s
  //   3I>>  PHHPTOC  start 0.10–40.00 ×In, IDMT or DT
  //   3I>>> PHIPTOC  start 1.00–40.00 ×In, DT only, ≥0.02 s
  "ABB-REM615": {
    label: "ABB REM615 (Relion)",
    plugMin: 0.05, plugMax: 5, plugStep: 0.05,
    tmsMin: 0.05, tmsMax: 15,
    dtMin: 0.04, dtMax: 200,
    curves: ["IEC-SI", "IEC-VI", "IEC-EI", "IEC-LTI", "ABB-RI", "DT"],
    stages: 3,
  },
  // GE Multilin 869 motor protection. Phase O/C uses IEEE C37.112 curves (the
  // time dial range 0.05–20), pickup to 20×CT; the thermal element is GE's
  // standard motor-overload curve (curve multiplier, set via thermal_curve_mult).
  "GE-869": {
    label: "GE Multilin 869",
    plugMin: 0.05, plugMax: 20, plugStep: 0.05,
    tmsMin: 0.05, tmsMax: 20,
    dtMin: 0.0, dtMax: 600,
    curves: ["IEEE-MI", "IEEE-VI", "IEEE-EI", "IEC-SI", "IEC-VI", "IEC-EI", "DT"],
    stages: 3,
  },
};

// Default CT fitted to a wire when the user adds a current transformer to it.
export const DEFAULT_CT_PARAMS: CtParams = {
  primary_a: 200,
  secondary_a: 5,
};

// Component types that can contribute a curve to the grading (TCC) study.
// Breakers resolve to the relay that trips them; the rest plot directly.
// A busbar contributes a vertical fault-level line rather than a curve.
export const GRADABLE_TYPES: ReadonlySet<ComponentType> = new Set<ComponentType>([
  "relay", "switch", "fuse", "motor", "cable", "transformer", "busbar",
]);

// Shared curve palette: the canvas dot on a selected component and its curve
// in the grading chart use the same colour, keyed by selection order.
export const GRADING_COLORS = [
  "#4ea1ff", "#38d39f", "#c792ea", "#ff8a65", "#ffd166", "#f87171", "#22d3ee", "#a3e635",
];

// Human-readable names for the IDMT curve families (UI dropdowns + chart
// legend). Keyed by the IdmtCurve union so TS strict forces completeness.
export const CURVE_LABELS: Record<IdmtCurve, string> = {
  "IEC-SI": "Standard Inverse",
  "IEC-VI": "Very Inverse",
  "IEC-EI": "Extremely Inverse",
  "IEC-LTI": "Long-Time Inverse",
  "ABB-RI": "RI Inverse (ABB)",
  "IEEE-MI": "IEEE Moderately Inverse",
  "IEEE-VI": "IEEE Very Inverse",
  "IEEE-EI": "IEEE Extremely Inverse",
  "DT": "Definite Time",
};

// IEC 60269 gG standard fuse current ratings (R10 / R20 series).
// Covers domestic 6 A through industrial 1250 A. Selecting a value snaps
// to one of these in the properties panel.
export const STANDARD_FUSE_SIZES_A: number[] = [
  2, 4, 6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250,
];

// Locked-rotor power factor seen on the supply side, by starting method.
// DOL / star-delta: the rotor really is stalled → highly inductive (~0.2).
// Soft-starter: similar inductive load, slightly improved by the chopped waveform.
// VFD: the rectifier + DC link presents near-unity PF to the supply — the motor's
// own poor PF is hidden behind the drive.
export const STARTING_PF_DEFAULTS: Record<MotorStartingMethod, number> = {
  "DOL": 0.20,
  "star-delta": 0.20,
  "soft-starter": 0.30,
  "VFD": 0.95,
};

export const DEFAULT_PARAMS: { [K in ComponentType]: ParamsByType[K] } = {
  grid_source: {
    nominal_voltage_kv: 11,
    short_circuit_mva: 500,
    xr_ratio: 10,
    scheduled_mw: 0,
  },
  busbar: {
    nominal_voltage_kv: 11,
    length_px: 200,
    arc_equipment_class: "switchgear",
    arc_grounded: true,
  },
  transformer: {
    rated_mva: 1.0,
    primary_kv: 11,
    secondary_kv: 0.4,
    impedance_percent: 5.0,
    xr_ratio: 10,
    vector_group: "Dyn11",
  },
  cable: {
    resistance_ohm_per_km: 0.124,
    reactance_ohm_per_km: 0.08,
    length_m: 50,
    ampacity_a: 400,
    csa_mm2: 120,
  },
  load: {
    active_power_kw: 100,
    reactive_power_kvar: 33,
  },
  motor: {
    rated_kw: 75,
    power_factor: 0.85,
    efficiency: 0.92,
    locked_rotor_current_ratio: 6.0,
    starting_method: "DOL",
    starting_pf: STARTING_PF_DEFAULTS.DOL,
    starting_time_s: 5,
  },
  switch: {
    closed: true,
    device_type: "breaker",
  },
  fuse: {
    rated_current_a: 63,
    fuse_class: "gG",
    breaking_capacity_ka: 80,
    intact: true,
  },
  relay: {
    relay_model: "generic",
    curve: "IEC-SI",
    plug_setting: 1.0,
    time_multiplier: 0.1,
    definite_time_s: 0.5,
    stage2_enabled: false,
    stage2_pickup: 5.0,
    stage2_curve: "DT",
    stage2_tms: 0.1,
    stage2_time_s: 0.3,
    stage3_enabled: false,
    stage3_pickup: 20.0,
    stage3_time_s: 0.05,
    thermal_enabled: false,
    thermal_tau_min: 15,
    thermal_k: 1.05,
    thermal_base_a: 0,
    thermal_curve_mult: 4,
    measured_connection_id: null,
  },
};

export const COMPONENT_LABELS: { [K in ComponentType]: string } = {
  grid_source: "Grid Source",
  busbar: "Busbar",
  transformer: "Transformer",
  cable: "Cable",
  load: "Load",
  motor: "Motor",
  switch: "Switch / CB",
  fuse: "Fuse",
  relay: "Relay (51)",
};

export const COMPONENT_PREFIXES: { [K in ComponentType]: string } = {
  grid_source: "SRC",
  busbar: "BB",
  transformer: "TX",
  cable: "CBL",
  load: "LD",
  motor: "M",
  switch: "Q",
  fuse: "F",
  relay: "RLY",
};

// How many terminals each component has (for connection validation).
export const TERMINAL_COUNT: { [K in ComponentType]: number } = {
  grid_source: 1,
  busbar: 1, // a bus accepts many connections at one logical terminal
  transformer: 2,
  cable: 2,
  load: 1,
  motor: 1,
  switch: 2,
  fuse: 2,
  // Relays attach via a control wire only — no required power terminals, so the
  // connectivity check never blocks a run on an unwired relay.
  relay: 0,
};

// Which component types are "branch" elements (must connect bus-to-bus).
// Fuses, like switches, are absorbed into bus classes via union-find — they
// follow the same flexible-neighbour rules so the user can drop a fuse on
// any wire without needing a synthetic bus on each side.
export const IS_BRANCH: { [K in ComponentType]: boolean } = {
  grid_source: false,
  busbar: false,
  transformer: true,
  cable: true,
  load: false,
  motor: false,
  switch: true,
  fuse: true,
  relay: false,
};
