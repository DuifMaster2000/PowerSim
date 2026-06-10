import type { ProjectFile } from "../types";

export const threeBusPv: ProjectFile = {
  version: "1.0",
  metadata: { name: "Three-bus PV", created: "2026-05-25", modified: "2026-05-25" },
  system: { base_mva: 50, frequency_hz: 50 },
  components: [
    {
      id: "SRC-1",
      type: "grid_source",
      label: "SLACK",
      position: { x: 100, y: 40 },
      parameters: { nominal_voltage_kv: 33, short_circuit_mva: 2000, xr_ratio: 12, scheduled_mw: 0 },
    },
    {
      id: "BB-1",
      type: "busbar",
      label: "HV-NORTH",
      position: { x: 40, y: 140 },
      parameters: { nominal_voltage_kv: 33, length_px: 220 },
    },
    {
      id: "CBL-1",
      type: "cable",
      label: "TIE-CBL",
      position: { x: 300, y: 220 },
      parameters: { resistance_ohm_per_km: 0.12, reactance_ohm_per_km: 0.30, length_m: 4000, ampacity_a: 400 },
    },
    {
      id: "BB-2",
      type: "busbar",
      label: "HV-SOUTH",
      position: { x: 380, y: 140 },
      parameters: { nominal_voltage_kv: 33, length_px: 220 },
    },
    {
      id: "SRC-2",
      type: "grid_source",
      label: "EMBEDDED-GEN",
      position: { x: 460, y: 40 },
      parameters: { nominal_voltage_kv: 33, short_circuit_mva: 800, xr_ratio: 8, scheduled_mw: 15 },
    },
    {
      id: "LD-1",
      type: "load",
      label: "FEEDER-N",
      position: { x: 120, y: 240 },
      parameters: { active_power_kw: 8000, reactive_power_kvar: 2500 },
    },
    {
      id: "LD-2",
      type: "load",
      label: "FEEDER-S",
      position: { x: 460, y: 240 },
      parameters: { active_power_kw: 12000, reactive_power_kvar: 4000 },
    },
  ],
  connections: [
    { id: "conn-1", fromComponent: "SRC-1", fromTerminal: "out", toComponent: "BB-1", toTerminal: "top" },
    { id: "conn-2", fromComponent: "BB-1", fromTerminal: "bottom", toComponent: "CBL-1", toTerminal: "from" },
    { id: "conn-3", fromComponent: "CBL-1", fromTerminal: "to", toComponent: "BB-2", toTerminal: "bottom" },
    { id: "conn-4", fromComponent: "SRC-2", fromTerminal: "out", toComponent: "BB-2", toTerminal: "top" },
    { id: "conn-5", fromComponent: "BB-1", fromTerminal: "bottom", toComponent: "LD-1", toTerminal: "in" },
    { id: "conn-6", fromComponent: "BB-2", fromTerminal: "bottom", toComponent: "LD-2", toTerminal: "in" },
  ],
};
