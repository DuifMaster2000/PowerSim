// =====================================================================
// Default parameter values when a new component is dropped on the canvas.
// =====================================================================

import type { ComponentType, ParamsByType, MotorStartingMethod, IdmtCurve } from "./types";

// Human-readable names for the IDMT curve families (UI dropdowns + chart
// legend). Keyed by the IdmtCurve union so TS strict forces completeness.
export const CURVE_LABELS: Record<IdmtCurve, string> = {
  "IEC-SI": "Standard Inverse",
  "IEC-VI": "Very Inverse",
  "IEC-EI": "Extremely Inverse",
  "IEC-LTI": "Long-Time Inverse",
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
    curve: "IEC-SI",
    plug_setting: 1.0,
    time_multiplier: 0.1,
    definite_time_s: 0.5,
  },
  ct: {
    primary_a: 200,
    secondary_a: 5,
    on_connection_id: null,
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
  ct: "CT",
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
  ct: "CT",
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
  // Relays and CTs attach via control wires only — no required power terminals,
  // so the connectivity check never blocks a run on an unwired relay/CT.
  relay: 0,
  ct: 0,
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
  ct: false,
};
