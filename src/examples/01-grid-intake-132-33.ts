import type { ProjectFile } from "../types";
import { DEFAULT_PARAMS, DEFAULT_CT_PARAMS } from "../defaults";

// Simplest realistic intake: a 132 kV grid feeds a 132/33 kV transformer
// through an incomer breaker (with a CT and an overcurrent relay), then a
// 33 kV feeder cable to a bulk load. Hello-world for load flow + protection.
export const gridIntake132_33: ProjectFile = {
  version: "1.0",
  metadata: { name: "Grid intake — 132/33 kV", created: "2026-06-17", modified: "2026-06-17" },
  system: { base_mva: 100, frequency_hz: 50 },
  components: [
    {
      id: "SRC-1",
      type: "grid_source",
      label: "GRID-132",
      position: { x: 280, y: 20 },
      parameters: { nominal_voltage_kv: 132, short_circuit_mva: 3500, xr_ratio: 15, scheduled_mw: 0 },
    },
    {
      id: "Q-IN",
      type: "switch",
      label: "Q-INCOMER",
      position: { x: 300, y: 110 },
      parameters: { closed: true, device_type: "breaker" },
    },
    {
      id: "RLY-IN",
      type: "relay",
      label: "RLY-INCOMER",
      position: { x: 440, y: 105 },
      parameters: { ...DEFAULT_PARAMS.relay, relay_model: "ABB-REM615", curve: "IEC-SI", plug_setting: 1.0, time_multiplier: 0.3, measured_connection_id: "conn-src-q" },
    },
    {
      id: "BB-132",
      type: "busbar",
      label: "BB-132",
      position: { x: 180, y: 200 },
      parameters: { nominal_voltage_kv: 132, length_px: 280, arc_equipment_class: "switchgear", arc_grounded: true, arc_electrode_config: "VCB" },
    },
    {
      id: "TX-1",
      type: "transformer",
      label: "TX-132/33",
      position: { x: 260, y: 290 },
      parameters: { rated_mva: 40, primary_kv: 132, secondary_kv: 33, impedance_percent: 12, xr_ratio: 20, vector_group: "YNd11" },
    },
    {
      id: "BB-33",
      type: "busbar",
      label: "BB-33",
      position: { x: 180, y: 400 },
      parameters: { nominal_voltage_kv: 33, length_px: 280, arc_equipment_class: "switchgear", arc_grounded: true, arc_electrode_config: "VCB" },
    },
    {
      id: "CBL-1",
      type: "cable",
      label: "FDR-33",
      position: { x: 260, y: 480 },
      parameters: { resistance_ohm_per_km: 0.08, reactance_ohm_per_km: 0.1, length_m: 2000, ampacity_a: 600, csa_mm2: 300 },
    },
    {
      id: "LD-1",
      type: "load",
      label: "TOWN-FDR",
      position: { x: 220, y: 560 },
      parameters: { active_power_kw: 14000, reactive_power_kvar: 5000 },
    },
  ],
  connections: [
    { id: "conn-src-q", fromComponent: "SRC-1", fromTerminal: "out", toComponent: "Q-IN", toTerminal: "in", ct: { ...DEFAULT_CT_PARAMS, primary_a: 200, secondary_a: 1 } },
    { id: "conn-q-bb", fromComponent: "Q-IN", fromTerminal: "out", toComponent: "BB-132", toTerminal: "top" },
    { id: "conn-rly", fromComponent: "RLY-IN", fromTerminal: "trip", toComponent: "Q-IN", toTerminal: "in" },
    { id: "conn-bb-tx", fromComponent: "BB-132", fromTerminal: "bottom", toComponent: "TX-1", toTerminal: "primary" },
    { id: "conn-tx-bb33", fromComponent: "TX-1", fromTerminal: "secondary", toComponent: "BB-33", toTerminal: "top" },
    { id: "conn-bb33-cbl", fromComponent: "BB-33", fromTerminal: "bottom", toComponent: "CBL-1", toTerminal: "from" },
    { id: "conn-cbl-ld", fromComponent: "CBL-1", fromTerminal: "to", toComponent: "LD-1", toTerminal: "in" },
  ],
};
