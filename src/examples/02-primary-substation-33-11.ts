import type { ProjectFile } from "../types";
import { DEFAULT_PARAMS, DEFAULT_CT_PARAMS } from "../defaults";

// 33/11 kV primary substation with a graded protection scheme: an incomer
// relay protecting the transformer, a relay-protected 11 kV feeder, and a
// fuse-protected 11 kV feeder. Good for the Grading (TCC) study.
export const primarySubstation33_11: ProjectFile = {
  version: "1.0",
  metadata: { name: "Primary substation — 33/11 kV", created: "2026-06-17", modified: "2026-06-17" },
  system: { base_mva: 50, frequency_hz: 50 },
  components: [
    {
      id: "SRC-1",
      type: "grid_source",
      label: "GRID-33",
      position: { x: 300, y: 20 },
      parameters: { nominal_voltage_kv: 33, short_circuit_mva: 1500, xr_ratio: 12, scheduled_mw: 0 },
    },
    {
      id: "Q-IN",
      type: "switch",
      label: "Q-INCOMER",
      position: { x: 320, y: 100 },
      parameters: { closed: true, device_type: "breaker" },
    },
    {
      id: "RLY-IN",
      type: "relay",
      label: "RLY-INCOMER",
      position: { x: 450, y: 95 },
      parameters: { ...DEFAULT_PARAMS.relay, relay_model: "ABB-REM615", curve: "IEC-SI", plug_setting: 1.0, time_multiplier: 0.3, measured_connection_id: "conn-src-q" },
    },
    {
      id: "BB-33",
      type: "busbar",
      label: "BB-33",
      position: { x: 200, y: 190 },
      parameters: { nominal_voltage_kv: 33, length_px: 300, arc_equipment_class: "switchgear", arc_grounded: true, arc_electrode_config: "VCB" },
    },
    {
      id: "TX-1",
      type: "transformer",
      label: "TX-33/11",
      position: { x: 280, y: 280 },
      parameters: { rated_mva: 20, primary_kv: 33, secondary_kv: 11, impedance_percent: 10, xr_ratio: 15, vector_group: "Dyn11" },
    },
    {
      id: "BB-11",
      type: "busbar",
      label: "BB-11",
      position: { x: 120, y: 390 },
      parameters: { nominal_voltage_kv: 11, length_px: 520, arc_equipment_class: "switchgear", arc_grounded: true, arc_electrode_config: "VCB" },
    },
    {
      id: "Q-F1",
      type: "switch",
      label: "Q-FDR1",
      position: { x: 150, y: 470 },
      parameters: { closed: true, device_type: "breaker" },
    },
    {
      id: "RLY-F1",
      type: "relay",
      label: "RLY-FDR1",
      position: { x: 280, y: 465 },
      parameters: { ...DEFAULT_PARAMS.relay, relay_model: "ABB-REM615", curve: "IEC-SI", plug_setting: 1.0, time_multiplier: 0.12, measured_connection_id: "conn-bb11-qf1" },
    },
    {
      id: "CBL-1",
      type: "cable",
      label: "FDR1-CBL",
      position: { x: 150, y: 550 },
      parameters: { resistance_ohm_per_km: 0.16, reactance_ohm_per_km: 0.1, length_m: 1500, ampacity_a: 400, csa_mm2: 185 },
    },
    {
      id: "LD-1",
      type: "load",
      label: "FDR1-LOAD",
      position: { x: 110, y: 630 },
      parameters: { active_power_kw: 4000, reactive_power_kvar: 1500 },
    },
    {
      id: "F-1",
      type: "fuse",
      label: "F-FDR2",
      position: { x: 470, y: 470 },
      parameters: { rated_current_a: 200, fuse_class: "gG", breaking_capacity_ka: 40, intact: true },
    },
    {
      id: "CBL-2",
      type: "cable",
      label: "FDR2-CBL",
      position: { x: 470, y: 550 },
      parameters: { resistance_ohm_per_km: 0.32, reactance_ohm_per_km: 0.11, length_m: 1000, ampacity_a: 250, csa_mm2: 95 },
    },
    {
      id: "LD-2",
      type: "load",
      label: "FDR2-LOAD",
      position: { x: 430, y: 630 },
      parameters: { active_power_kw: 2000, reactive_power_kvar: 800 },
    },
  ],
  connections: [
    { id: "conn-src-q", fromComponent: "SRC-1", fromTerminal: "out", toComponent: "Q-IN", toTerminal: "in", ct: { ...DEFAULT_CT_PARAMS, primary_a: 400, secondary_a: 1 } },
    { id: "conn-q-bb33", fromComponent: "Q-IN", fromTerminal: "out", toComponent: "BB-33", toTerminal: "top" },
    { id: "conn-rly-in", fromComponent: "RLY-IN", fromTerminal: "trip", toComponent: "Q-IN", toTerminal: "in" },
    { id: "conn-bb33-tx", fromComponent: "BB-33", fromTerminal: "bottom", toComponent: "TX-1", toTerminal: "primary" },
    { id: "conn-tx-bb11", fromComponent: "TX-1", fromTerminal: "secondary", toComponent: "BB-11", toTerminal: "top" },
    { id: "conn-bb11-qf1", fromComponent: "BB-11", fromTerminal: "bottom", toComponent: "Q-F1", toTerminal: "in", ct: { ...DEFAULT_CT_PARAMS, primary_a: 300, secondary_a: 1 } },
    { id: "conn-qf1-cbl", fromComponent: "Q-F1", fromTerminal: "out", toComponent: "CBL-1", toTerminal: "from" },
    { id: "conn-rly-f1", fromComponent: "RLY-F1", fromTerminal: "trip", toComponent: "Q-F1", toTerminal: "in" },
    { id: "conn-cbl1-ld", fromComponent: "CBL-1", fromTerminal: "to", toComponent: "LD-1", toTerminal: "in" },
    { id: "conn-bb11-f1", fromComponent: "BB-11", fromTerminal: "bottom", toComponent: "F-1", toTerminal: "in" },
    { id: "conn-f1-cbl", fromComponent: "F-1", fromTerminal: "out", toComponent: "CBL-2", toTerminal: "from" },
    { id: "conn-cbl2-ld", fromComponent: "CBL-2", fromTerminal: "to", toComponent: "LD-2", toTerminal: "in" },
  ],
};
