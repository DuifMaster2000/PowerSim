import type { ProjectFile } from "../types";
import { DEFAULT_PARAMS, DEFAULT_CT_PARAMS } from "../defaults";

// 11 kV board feeds an 11/6.6 kV transformer supplying a large 6.6 kV motor
// through its own breaker, CT and GE-869 motor relay (with the thermal
// element enabled). Built for the Motor-starting study and motor protection
// grading (start curve vs thermal vs damage).
export const motorFeeder66: ProjectFile = {
  version: "1.0",
  metadata: { name: "MV motor feeder — 11/6.6 kV", created: "2026-06-17", modified: "2026-06-17" },
  system: { base_mva: 25, frequency_hz: 50 },
  components: [
    {
      id: "SRC-1",
      type: "grid_source",
      label: "BOARD-11",
      position: { x: 260, y: 20 },
      parameters: { nominal_voltage_kv: 11, short_circuit_mva: 500, xr_ratio: 10, scheduled_mw: 0 },
    },
    {
      id: "Q-IN",
      type: "switch",
      label: "Q-TX-FDR",
      position: { x: 280, y: 100 },
      parameters: { closed: true, device_type: "breaker" },
    },
    {
      id: "RLY-IN",
      type: "relay",
      label: "RLY-TX",
      position: { x: 410, y: 95 },
      parameters: { ...DEFAULT_PARAMS.relay, relay_model: "generic", curve: "IEC-SI", plug_setting: 1.0, time_multiplier: 0.2, measured_connection_id: "conn-src-q" },
    },
    {
      id: "BB-11",
      type: "busbar",
      label: "BB-11",
      position: { x: 160, y: 190 },
      parameters: { nominal_voltage_kv: 11, length_px: 280, arc_equipment_class: "switchgear", arc_grounded: true, arc_electrode_config: "VCB" },
    },
    {
      id: "TX-1",
      type: "transformer",
      label: "TX-11/6.6",
      position: { x: 240, y: 280 },
      parameters: { rated_mva: 8, primary_kv: 11, secondary_kv: 6.6, impedance_percent: 7, xr_ratio: 12, vector_group: "Dyn11" },
    },
    {
      id: "BB-66",
      type: "busbar",
      label: "BB-6.6",
      position: { x: 160, y: 390 },
      parameters: { nominal_voltage_kv: 6.6, length_px: 320, arc_equipment_class: "switchgear", arc_grounded: true, arc_electrode_config: "VCB" },
    },
    {
      id: "LD-1",
      type: "load",
      label: "AUX-LOAD",
      position: { x: 120, y: 470 },
      parameters: { active_power_kw: 1000, reactive_power_kvar: 400 },
    },
    {
      id: "Q-M",
      type: "switch",
      label: "Q-MOTOR",
      position: { x: 320, y: 470 },
      parameters: { closed: true, device_type: "breaker" },
    },
    {
      id: "RLY-M",
      type: "relay",
      label: "RLY-MOTOR",
      position: { x: 450, y: 465 },
      parameters: { ...DEFAULT_PARAMS.relay, relay_model: "GE-869", curve: "IEEE-MI", plug_setting: 1.2, time_multiplier: 0.1, thermal_enabled: true, thermal_k: 1.1, thermal_curve_mult: 4, thermal_base_a: 0, measured_connection_id: "conn-bb66-qm" },
    },
    {
      id: "CBL-1",
      type: "cable",
      label: "MTR-CBL",
      position: { x: 320, y: 550 },
      parameters: { resistance_ohm_per_km: 0.16, reactance_ohm_per_km: 0.1, length_m: 250, ampacity_a: 350, csa_mm2: 185 },
    },
    {
      id: "M-1",
      type: "motor",
      label: "M-DRIVE",
      position: { x: 300, y: 630 },
      parameters: { rated_kw: 2500, power_factor: 0.88, efficiency: 0.95, locked_rotor_current_ratio: 6, starting_method: "DOL", starting_pf: 0.2, starting_time_s: 8 },
    },
  ],
  connections: [
    { id: "conn-src-q", fromComponent: "SRC-1", fromTerminal: "out", toComponent: "Q-IN", toTerminal: "in", ct: { ...DEFAULT_CT_PARAMS, primary_a: 500, secondary_a: 1 } },
    { id: "conn-q-bb11", fromComponent: "Q-IN", fromTerminal: "out", toComponent: "BB-11", toTerminal: "top" },
    { id: "conn-rly-in", fromComponent: "RLY-IN", fromTerminal: "trip", toComponent: "Q-IN", toTerminal: "in" },
    { id: "conn-bb11-tx", fromComponent: "BB-11", fromTerminal: "bottom", toComponent: "TX-1", toTerminal: "primary" },
    { id: "conn-tx-bb66", fromComponent: "TX-1", fromTerminal: "secondary", toComponent: "BB-66", toTerminal: "top" },
    { id: "conn-bb66-ld", fromComponent: "BB-66", fromTerminal: "bottom", toComponent: "LD-1", toTerminal: "in" },
    { id: "conn-bb66-qm", fromComponent: "BB-66", fromTerminal: "bottom", toComponent: "Q-M", toTerminal: "in", ct: { ...DEFAULT_CT_PARAMS, primary_a: 300, secondary_a: 1 } },
    { id: "conn-qm-cbl", fromComponent: "Q-M", fromTerminal: "out", toComponent: "CBL-1", toTerminal: "from" },
    { id: "conn-rly-m", fromComponent: "RLY-M", fromTerminal: "trip", toComponent: "Q-M", toTerminal: "in" },
    { id: "conn-cbl-m", fromComponent: "CBL-1", fromTerminal: "to", toComponent: "M-1", toTerminal: "in" },
  ],
};
