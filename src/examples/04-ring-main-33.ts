import type { ProjectFile } from "../types";
import { DEFAULT_CT_PARAMS } from "../defaults";

// 33 kV ring main fed from the grid at BUS-A with an embedded generator at
// BUS-C (modelled as a PV bus via scheduled MW). The closed ring makes the
// Newton-Raphson solve take several iterations — good for the iteration
// animation. Incomer and generator breakers carry CTs.
export const ringMain33: ProjectFile = {
  version: "1.0",
  metadata: { name: "Ring main — 33 kV + embedded gen", created: "2026-06-17", modified: "2026-06-17" },
  system: { base_mva: 100, frequency_hz: 50 },
  components: [
    {
      id: "SRC-1",
      type: "grid_source",
      label: "GRID-33",
      position: { x: 240, y: 20 },
      parameters: { nominal_voltage_kv: 33, short_circuit_mva: 2000, xr_ratio: 12, scheduled_mw: 0 },
    },
    {
      id: "Q-IN",
      type: "switch",
      label: "Q-GRID",
      position: { x: 260, y: 100 },
      parameters: { closed: true, device_type: "breaker" },
    },
    {
      id: "BB-A",
      type: "busbar",
      label: "BUS-A",
      position: { x: 180, y: 180 },
      parameters: { nominal_voltage_kv: 33, length_px: 240, arc_equipment_class: "switchgear", arc_grounded: true, arc_electrode_config: "VCB" },
    },
    {
      id: "BB-B",
      type: "busbar",
      label: "BUS-B",
      position: { x: 20, y: 380 },
      parameters: { nominal_voltage_kv: 33, length_px: 220, arc_equipment_class: "switchgear", arc_grounded: true, arc_electrode_config: "VCB" },
    },
    {
      id: "BB-C",
      type: "busbar",
      label: "BUS-C",
      position: { x: 380, y: 380 },
      parameters: { nominal_voltage_kv: 33, length_px: 220, arc_equipment_class: "switchgear", arc_grounded: true, arc_electrode_config: "VCB" },
    },
    {
      id: "CBL-AB",
      type: "cable",
      label: "RING-A-B",
      position: { x: 90, y: 280 },
      parameters: { resistance_ohm_per_km: 0.1, reactance_ohm_per_km: 0.12, length_m: 3500, ampacity_a: 500, csa_mm2: 240 },
    },
    {
      id: "CBL-BC",
      type: "cable",
      label: "RING-B-C",
      position: { x: 240, y: 470 },
      parameters: { resistance_ohm_per_km: 0.1, reactance_ohm_per_km: 0.12, length_m: 5000, ampacity_a: 500, csa_mm2: 240 },
    },
    {
      id: "CBL-CA",
      type: "cable",
      label: "RING-C-A",
      position: { x: 380, y: 280 },
      parameters: { resistance_ohm_per_km: 0.1, reactance_ohm_per_km: 0.12, length_m: 4000, ampacity_a: 500, csa_mm2: 240 },
    },
    {
      id: "SRC-2",
      type: "grid_source",
      label: "EMBED-GEN",
      position: { x: 480, y: 280 },
      parameters: { nominal_voltage_kv: 33, short_circuit_mva: 600, xr_ratio: 8, scheduled_mw: 20 },
    },
    {
      id: "Q-GEN",
      type: "switch",
      label: "Q-GEN",
      position: { x: 470, y: 350 },
      parameters: { closed: true, device_type: "breaker" },
    },
    {
      id: "LD-B",
      type: "load",
      label: "LOAD-B",
      position: { x: 30, y: 470 },
      parameters: { active_power_kw: 25000, reactive_power_kvar: 8000 },
    },
    {
      id: "LD-C",
      type: "load",
      label: "LOAD-C",
      position: { x: 320, y: 470 },
      parameters: { active_power_kw: 20000, reactive_power_kvar: 6000 },
    },
  ],
  connections: [
    { id: "conn-src-q", fromComponent: "SRC-1", fromTerminal: "out", toComponent: "Q-IN", toTerminal: "in", ct: { ...DEFAULT_CT_PARAMS, primary_a: 1000, secondary_a: 1 } },
    { id: "conn-q-bba", fromComponent: "Q-IN", fromTerminal: "out", toComponent: "BB-A", toTerminal: "top" },
    { id: "conn-bba-ab", fromComponent: "BB-A", fromTerminal: "bottom", toComponent: "CBL-AB", toTerminal: "from" },
    { id: "conn-ab-bbb", fromComponent: "CBL-AB", fromTerminal: "to", toComponent: "BB-B", toTerminal: "top" },
    { id: "conn-bbb-bc", fromComponent: "BB-B", fromTerminal: "bottom", toComponent: "CBL-BC", toTerminal: "from" },
    { id: "conn-bc-bbc", fromComponent: "CBL-BC", fromTerminal: "to", toComponent: "BB-C", toTerminal: "top" },
    { id: "conn-bbc-ca", fromComponent: "BB-C", fromTerminal: "bottom", toComponent: "CBL-CA", toTerminal: "from" },
    { id: "conn-ca-bba", fromComponent: "CBL-CA", fromTerminal: "to", toComponent: "BB-A", toTerminal: "bottom" },
    { id: "conn-gen-q", fromComponent: "SRC-2", fromTerminal: "out", toComponent: "Q-GEN", toTerminal: "in", ct: { ...DEFAULT_CT_PARAMS, primary_a: 600, secondary_a: 1 } },
    { id: "conn-q-bbc", fromComponent: "Q-GEN", fromTerminal: "out", toComponent: "BB-C", toTerminal: "top" },
    { id: "conn-bbb-ld", fromComponent: "BB-B", fromTerminal: "bottom", toComponent: "LD-B", toTerminal: "in" },
    { id: "conn-bbc-ld", fromComponent: "BB-C", fromTerminal: "bottom", toComponent: "LD-C", toTerminal: "in" },
  ],
};
