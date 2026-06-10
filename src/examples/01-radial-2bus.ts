import type { ProjectFile } from "../types";

export const radial2Bus: ProjectFile = {
  version: "1.0",
  metadata: { name: "Radial — 2 bus", created: "2026-05-25", modified: "2026-05-25" },
  system: { base_mva: 10, frequency_hz: 50 },
  components: [
    {
      id: "SRC-1",
      type: "grid_source",
      label: "GRID",
      position: { x: 200, y: 40 },
      parameters: { nominal_voltage_kv: 11, short_circuit_mva: 500, xr_ratio: 10, scheduled_mw: 0 },
    },
    {
      id: "BB-1",
      type: "busbar",
      label: "MV-01",
      position: { x: 120, y: 140 },
      parameters: { nominal_voltage_kv: 11, length_px: 220 },
    },
    {
      id: "TX-1",
      type: "transformer",
      label: "TX-01",
      position: { x: 200, y: 220 },
      parameters: { rated_mva: 1, primary_kv: 11, secondary_kv: 0.4, impedance_percent: 5, xr_ratio: 10, vector_group: "Dyn11" },
    },
    {
      id: "BB-2",
      type: "busbar",
      label: "LV-01",
      position: { x: 120, y: 340 },
      parameters: { nominal_voltage_kv: 0.4, length_px: 220 },
    },
    {
      id: "LD-1",
      type: "load",
      label: "LD-01",
      position: { x: 200, y: 420 },
      parameters: { active_power_kw: 600, reactive_power_kvar: 200 },
    },
  ],
  connections: [
    { id: "conn-1", fromComponent: "SRC-1", fromTerminal: "out", toComponent: "BB-1", toTerminal: "top" },
    { id: "conn-2", fromComponent: "BB-1", fromTerminal: "bottom", toComponent: "TX-1", toTerminal: "primary" },
    { id: "conn-3", fromComponent: "TX-1", fromTerminal: "secondary", toComponent: "BB-2", toTerminal: "top" },
    { id: "conn-4", fromComponent: "BB-2", fromTerminal: "bottom", toComponent: "LD-1", toTerminal: "in" },
  ],
};
