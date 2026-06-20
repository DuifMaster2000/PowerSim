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
  // Arc-flash equipment characteristics (IEEE 1584). Optional — legacy files
  // and example networks default these via ?? at the use sites.
  arc_equipment_class?: string; // equipment type (switchgear / MCC / cable / open-air)
  arc_grounded?: boolean;       // system grounding — affects 1584-2002 incident energy
  arc_electrode_config?: "VCB" | "VCBB" | "HCB" | "VOA" | "HOA"; // 1584-2018 electrode configuration
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
// "IEEE-*" are the IEEE C37.112 inverse curves (A,B,p constants) used by GE
// and other North-American relays — a different equation from the IEC family.
export type IdmtCurve =
  | "IEC-SI"   // Standard Inverse
  | "IEC-VI"   // Very Inverse
  | "IEC-EI"   // Extremely Inverse
  | "IEC-LTI"  // Long-Time Inverse
  | "ABB-RI"   // RI Inverse (ABB Relion)
  | "IEEE-MI"  // IEEE Moderately Inverse
  | "IEEE-VI"  // IEEE Very Inverse
  | "IEEE-EI"  // IEEE Extremely Inverse
  | "DT";      // Definite Time

// Relay hardware model: constrains the setting ranges and curve set in the
// properties panel to what the real device accepts.
export type RelayModel = "generic" | "ABB-REM615" | "GE-869";

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
  thermal_tau_min: number;  // thermal time constant τ [minutes] — IEC replica (ABB)
  thermal_k: number;        // overload / service factor (×base current allowed continuously)
  thermal_base_a: number;   // base/full-load current Ib [A]; 0 = auto (use the CT primary rating)
  thermal_curve_mult: number; // GE standard-overload curve multiplier (t = CM·87.4/(m²−1))
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
  derivation?: ShortCircuitDerivation; // step-by-step worked numbers for the methodology view
}

// ---------- Short-circuit methodology (the "how we got the answer" data) ----------
// The solver attaches the intermediate values; the methodology UI wraps them in
// prose + equations. Keeping this as raw numbers preserves the layering rule.

export interface ScSourceTerm {
  label: string;
  shortCircuitMva: number;
  xrRatio: number;
  rPu: number;       // source resistance, pu on system base
  xPu: number;       // source reactance, pu on system base
  zMagPu: number;    // |Z_src|, pu
  contributionKa: number;
}

export interface ScTransformerTerm {
  label: string;
  ratedMva: number;
  xTpu: number;      // reactance on the transformer's own rating (the x_T in K_T)
  ktFactor: number;  // IEC 60909 K_T at this run's c-factor
}

export interface ShortCircuitDerivation {
  standard: string;          // e.g. "IEC 60909-0 (simplified, 3-phase symmetrical)"
  faultBusLabel: string;
  cFactor: number;           // voltage factor c used
  baseMva: number;
  baseKv: number;            // base voltage at the fault bus
  baseCurrentA: number;      // I_base = baseMVA / (√3 · baseKv)
  sources: ScSourceTerm[];
  transformers: ScTransformerTerm[]; // every transformer in the model (K_T applied to SC)
  zThevRePu: number;         // Thevenin impedance at the fault bus (Z_kk)
  zThevImPu: number;
  zThevMagPu: number;
  xrAtFault: number;         // X/R at the fault bus
  ikPu: number;              // c / |Z_kk|
  ikSymKa: number;
  kappa: number;             // peak factor κ
  ipPeakKa: number;
}

// ---------- Arc flash (IEEE 1584) ----------

export interface ArcFlashResult {
  busId: string;
  busLabel: string;
  voltageKv: number;
  boltedKa: number;          // bolted 3-phase fault current
  arcingKa: number;          // arcing current (< bolted)
  clearingTimeS: number;     // arc duration used
  clearingSource: string;    // protective device that set the time, or "assumed"
  method: string;            // "IEEE 1584-2018" or "IEEE 1584-2002"
  equipmentClassLabel: string;
  electrodeConfig?: string;  // 2018 only
  gapMm: number;
  workingDistanceMm: number;
  grounded: boolean;
  outOfRange: boolean;       // true above 15 kV — IEEE 1584 is extrapolated (use Lee)
  incidentEnergyCal: number; // cal/cm² at the working distance
  arcFlashBoundaryMm: number;
  ppeCategory: number | null;
  ppeLabel: string;
  derivation?: ArcFlashDerivation; // worked intermediates for the methodology view
}

// Extra intermediate values for the arc-flash methodology view (the headline
// numbers already live on ArcFlashResult). Assembled where the clearing time
// is derived from protection.
export interface ArcFlashDerivation {
  scCFactor: number;            // IEC 60909 voltage factor used for the bolted current
  arcingRatio: number;          // I_arc / I_bolted
  distanceExponent: number;     // x — working-distance exponent (IEEE 1584-2002 Table 4)
  assumedClearingTime: boolean; // true → no protective device operated, 2.0 s assumed
  calcFactorCf?: number;        // C_f calculation factor (1.5 ≤1 kV, else 1.0) — 2002
  normalizedEnergyJ?: number;   // E_n normalized energy (J/cm² at 0.2 s & 610 mm) — 2002
  enclosureCorrection?: number; // enclosure-size correction factor CF — 2018
}

// ---------- Validation ----------

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
  componentId?: string;
}
