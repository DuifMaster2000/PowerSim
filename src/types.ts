// =====================================================================
// Type definitions for the power systems simulator.
// All component schemas, network structures, and solver result types.
// =====================================================================

export type ComponentType =
  | "grid_source"
  | "busbar"
  | "transformer"
  | "cable"
  | "load"
  | "motor"
  | "switch"
  | "fuse"
  | "relay";

export interface XY {
  x: number;
  y: number;
}

// ---------- Component parameter schemas ----------

export interface GridSourceParams {
  nominal_voltage_kv: number;
  short_circuit_mva: number;
  xr_ratio: number;
  scheduled_mw: number; // MW scheduled injection; first source is always slack regardless of this value
}

export interface BusbarParams {
  nominal_voltage_kv: number;
  length_px: number; // visual length of the busbar on the canvas
}

export interface TransformerParams {
  rated_mva: number;
  primary_kv: number;
  secondary_kv: number;
  impedance_percent: number;
  xr_ratio: number;
  vector_group: string;
}

export interface CableParams {
  resistance_ohm_per_km: number;
  reactance_ohm_per_km: number;
  length_m: number;
  ampacity_a: number;
  csa_mm2: number; // conductor cross-section — used for the thermal damage curve on the grading chart
}

export interface LoadParams {
  active_power_kw: number;
  reactive_power_kvar: number;
}

export type MotorStartingMethod = "DOL" | "star-delta" | "soft-starter" | "VFD";

export interface MotorParams {
  rated_kw: number;
  power_factor: number;
  efficiency: number;
  locked_rotor_current_ratio: number;
  starting_method: MotorStartingMethod;
  starting_pf: number; // locked-rotor power factor (typically 0.15–0.30, very inductive)
  starting_time_s: number; // run-up time — sets the width of the start curve on the grading chart
}

export interface SwitchParams {
  closed: boolean;
  device_type: "switch" | "fuse-switch" | "breaker";
}

export type FuseClass = "gG" | "gM" | "aM";

export interface FuseParams {
  rated_current_a: number;       // pick from STANDARD_FUSE_SIZES_A
  fuse_class: FuseClass;         // gG = general / gM = motor / aM = motor backup
  breaking_capacity_ka: number;  // typically 50 / 80 / 100 / 120 kA at LV
  intact: boolean;               // true = conducting, false = blown
}

// IEC 60255-151 standard inverse-time overcurrent characteristics, plus a
// definite-time option. Each maps to (K, α) constants in solver/idmt.ts.
// "ABB-RI" is ABB's RI inverse (Relion family) for grading against legacy
// ABB electromechanical relays — available only on ABB relay models.
export type IdmtCurve =
  | "IEC-SI"   // Standard Inverse
  | "IEC-VI"   // Very Inverse
  | "IEC-EI"   // Extremely Inverse
  | "IEC-LTI"  // Long-Time Inverse
  | "ABB-RI"   // RI Inverse (ABB Relion)
  | "DT";      // Definite Time

// Relay hardware model: constrains the setting ranges and curve set in the
// properties panel to what the real device accepts.
export type RelayModel = "generic" | "ABB-REM615";

export interface RelayParams {
  relay_model: RelayModel;
  // Stage 1 — low stage 3I> (PHLPTOC, "51")
  curve: IdmtCurve;
  plug_setting: number;     // pickup as a multiple of the CT secondary (Is/In), e.g. 1.0
  time_multiplier: number;  // TMS — scales the whole IDMT curve
  definite_time_s: number;  // operate time used when curve === "DT"
  // Stage 2 — high stage 3I>> (PHHPTOC, "50/51"). Multi-stage models only;
  // the relay trips on whichever enabled stage operates fastest.
  stage2_enabled: boolean;
  stage2_pickup: number;    // ×In, 0.10–40.00
  stage2_curve: IdmtCurve;
  stage2_tms: number;
  stage2_time_s: number;    // DT operate time when stage2_curve === "DT"
  // Stage 3 — instantaneous stage 3I>>> (PHIPTOC, "50"). Definite time only.
  stage3_enabled: boolean;
  stage3_pickup: number;    // ×In, 1.00–40.00
  stage3_time_s: number;    // ≥ 0.02 s
  // Thermal overload element (49T, MPTTR thermal image). Long-time inverse
  // curve modelling motor winding heating. Multi-stage models only.
  thermal_enabled: boolean;
  thermal_tau_min: number;  // thermal time constant τ [minutes]
  thermal_k: number;        // overload factor (×base current allowed continuously, ~1.0–1.2)
  // The connection (conductor) whose CT this relay measures. Picked from a
  // dropdown of CT-equipped wires in the relay's properties panel. null when
  // the relay has no CT assigned yet (surfaces a warning).
  measured_connection_id: string | null;
}

// A current transformer is a property of a power connection (wire), not a
// standalone component — it "clamps" onto the conductor the wire represents.
export interface CtParams {
  primary_a: number;        // CT primary rating, e.g. 100 / 200 / 400
  secondary_a: 1 | 5;       // standard CT secondary
}

export type ParamsByType = {
  grid_source: GridSourceParams;
  busbar: BusbarParams;
  transformer: TransformerParams;
  cable: CableParams;
  load: LoadParams;
  motor: MotorParams;
  switch: SwitchParams;
  fuse: FuseParams;
  relay: RelayParams;
};

// ---------- Generic component shape ----------

export interface PowerComponent<T extends ComponentType = ComponentType> {
  id: string;
  type: T;
  label: string;
  position: XY;
  parameters: ParamsByType[T];
}

export interface Connection {
  id: string;
  fromComponent: string;
  fromTerminal: string;
  toComponent: string;
  toTerminal: string;
  // Optional current transformer clamped onto this conductor. Present iff the
  // user has added a CT to the wire; relays reference it by this connection id.
  ct?: CtParams | null;
}

// ---------- Project file ----------

export interface ProjectFile {
  version: "1.0";
  metadata: {
    name: string;
    created: string;
    modified: string;
  };
  system: {
    base_mva: number;
    frequency_hz: number;
  };
  components: PowerComponent[];
  connections: Connection[];
  viewport?: { x: number; y: number; zoom: number };
}

// ---------- Solver results ----------

export interface BusResult {
  busId: string;
  label: string;
  nominalKv: number;
  voltageKv: number;
  voltagePu: number;
  angleDeg: number;
}

export interface BranchResult {
  branchId: string;
  label: string;
  componentType: "transformer" | "cable" | "switch";
  fromBus: string;
  toBus: string;
  currentA: number;
  loadingPercent: number;
  pMw: number;
  qMvar: number;
}

export interface LoadResult {
  loadId: string; // component id of the load or motor
  label: string;
  componentType: "load" | "motor";
  busId: string;
  currentA: number;
  pKw: number;
  qKvar: number;
}

export interface IterationSnapshot {
  iter: number;
  V: number[];           // per-bus voltage magnitude pu (dense, length = n)
  theta: number[];       // per-bus angle rad
  mismatchP: number[];   // per-bus ΔP pu (slack entry is 0)
  mismatchQ: number[];   // per-bus ΔQ pu (slack and PV entries are 0)
  maxMismatch: number;   // largest |ΔP|, |ΔQ| over all non-slack/non-PV terms
}

export interface LoadFlowOptions {
  captureHistory?: boolean;
}

export interface LoadFlowResult {
  converged: boolean;
  iterations: number;
  message?: string;
  buses: BusResult[];
  branches: BranchResult[];
  loads: LoadResult[]; // per-load currents (loads and motors)
  history?: IterationSnapshot[]; // present iff captureHistory was true
}

// ---------- Motor starting ----------

export interface BusDipResult {
  busId: string;
  label: string;
  nominalKv: number;
  preStartVoltagePu: number;
  duringStartVoltagePu: number;
  duringStartVoltageKv: number;
  dipPercent: number; // (pre − during) / pre × 100, always ≥ 0 for normal cases
}

export interface MotorStartingResult {
  converged: boolean;
  iterations: number;
  message?: string;

  motorId: string;
  motorLabel: string;
  motorBusId: string;
  motorBusLabel: string;
  startingMethod: MotorStartingMethod;

  // Effective starting-current multiplier of full-load amps used in the model.
  // DOL → LRC, star-delta → LRC/3, soft-starter → min(LRC, 3.5), VFD → ~1.1
  effectiveStartingCurrentRatio: number;

  // Motor full-load reference values (at rated voltage, normal operation)
  fullLoadCurrentA: number;
  fullLoadKva: number;

  // During-start quantities at the motor terminals
  terminalVoltagePu: number;
  terminalVoltageKv: number;
  startingCurrentA: number;
  startingKva: number;
  startingKw: number;
  startingKvar: number;

  // Voltage at every bus before and during the start
  busDips: BusDipResult[];

  // Branch flows during the start (so the user can see the inrush path)
  duringStartBranches: BranchResult[];
}

export interface ShortCircuitContribution {
  sourceId: string;
  label: string;
  currentKa: number;
}

// Per-branch fault current along the path to the fault bus. Lets the canvas
// show the equivalent kA on each side of a transformer (primary vs secondary)
// instead of only the source-side contribution.
export interface ShortCircuitBranchFlow {
  branchId: string;
  componentType: "transformer" | "cable";
  fromBusId: string;
  toBusId: string;
  fromSideKa: number;
  toSideKa: number;
  faultOnFromSide: boolean; // which side of the branch holds the fault bus
}

export interface ShortCircuitResult {
  faultBusId: string;
  faultBusLabel: string;
  ikSymKa: number; // I_k" — initial symmetrical short-circuit current
  ipPeakKa: number; // i_p — peak short-circuit current
  contributions: ShortCircuitContribution[];
  branchFlows: ShortCircuitBranchFlow[];
}

// ---------- Validation ----------

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
  componentId?: string;
}
