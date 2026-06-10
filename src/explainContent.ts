// =====================================================================
// Educational content — definitions, formulas, and worked examples for
// the v0.6 "Explain mode". Pure data, no React. The single source of
// truth for both inline tooltips and the glossary drawer.
//
// Lookup convention for parameter tooltips:
//   `${componentType}.${fieldKey}`  (e.g. "transformer.impedance_percent")
// falling back to:
//   `${fieldKey}`                   (e.g. "xr_ratio")
// =====================================================================

export interface ExplainEntry {
  title: string;
  body: string;
  formula?: string;
  typical?: string;
  example?: string;
}

export const EXPLAIN: Record<string, ExplainEntry> = {
  // ---------- Shared concepts ----------
  xr_ratio: {
    title: "X/R ratio",
    body:
      "Ratio of reactance to resistance. Higher means more inductive (more reactive impedance), which produces a larger peak short-circuit current (i_p) for the same RMS.",
    typical: "Cables: 1–5 · Transformers: 5–20 · Grid sources: 5–25",
  },
  nominal_voltage_kv: {
    title: "Nominal voltage",
    body:
      "Line-to-line rated voltage of this bus or source. Defines the per-unit base for everything that connects to it.",
    formula: "V_base [kV] = nominal voltage",
    typical: "LV 0.4 · MV 3.3 / 6.6 / 11 · HV 33 / 66 / 132",
  },

  // ---------- Grid source ----------
  "grid_source.nominal_voltage_kv": {
    title: "Source voltage",
    body:
      "Line-to-line voltage delivered by the upstream grid. Used as the per-unit base for the bus the source connects to. The first grid source in a project is the slack bus (V = 1.0 pu, angle = 0).",
    typical: "Distribution feeder: 11 kV / 22 kV / 33 kV",
  },
  "grid_source.short_circuit_mva": {
    title: "Short-circuit MVA",
    body:
      "Strength of the upstream grid — the three-phase fault MVA available at the connection point. Larger means a stiffer source (less voltage dip under load, more fault current).",
    formula: "Z_source_pu = baseMVA / S_sc_MVA",
    typical: "Weak rural: 50–200 · Urban: 500–2000 · Strong industrial: 5000+",
  },
  "grid_source.xr_ratio": {
    title: "Source X/R",
    body:
      "Reactance-to-resistance ratio of the upstream grid. With S_sc and X/R you get both R and X for the source impedance.",
    typical: "5–25 for transmission-fed sources",
  },
  "grid_source.scheduled_mw": {
    title: "Scheduled injection",
    body:
      "MW that this source is asked to inject. Ignored for the slack bus (it balances the system). For additional grid sources this becomes the scheduled P of a PV bus (fixed V, fixed P).",
    typical: "0 for a stand-by tie; positive for a generator/embedded source",
  },

  // ---------- Busbar ----------
  "busbar.nominal_voltage_kv": {
    title: "Busbar nominal voltage",
    body:
      "Line-to-line voltage rating of the busbar. Defines the per-unit base for this bus and indirectly for connected cables and loads.",
  },
  "busbar.length_px": {
    title: "Bar length (visual)",
    body:
      "Drawing length on the canvas only — has no electrical effect. Drag the right edge of the busbar to resize.",
  },

  // ---------- Transformer ----------
  "transformer.rated_mva": {
    title: "Rated MVA",
    body:
      "Nameplate apparent power. Loading-percent calculations are referenced to this value. The per-unit impedance also rescales when the project base differs from the rated MVA.",
  },
  "transformer.primary_kv": {
    title: "Primary voltage",
    body:
      "HV-side line-to-line rated voltage. Should match the busbar this side connects to (a warning fires otherwise).",
  },
  "transformer.secondary_kv": {
    title: "Secondary voltage",
    body:
      "LV-side line-to-line rated voltage. Should match the busbar this side connects to.",
  },
  "transformer.impedance_percent": {
    title: "Short-circuit impedance %",
    body:
      "Nameplate impedance from the short-circuit test, expressed as a percentage of the transformer's own base. The solver converts it to per-unit on the project base.",
    formula: "Z_pu = (Z% / 100) × (baseMVA / ratedMVA)",
    typical: "Distribution: 4–6 % · Power: 8–14 %",
  },
  "transformer.xr_ratio": {
    title: "Transformer X/R",
    body:
      "Ratio of leakage reactance to copper resistance. Together with Z% it determines R and X separately, which matters for losses and for the peak fault current factor κ.",
    typical: "Distribution: 5–15 · Power: 15–40",
  },
  "transformer.vector_group": {
    title: "Vector group",
    body:
      "Winding configuration and phase shift (e.g. Dyn11 = delta primary, star secondary with neutral, 30° lag). Not yet used by the steady-state solver; recorded for documentation.",
  },

  // ---------- Cable ----------
  "cable.resistance_ohm_per_km": {
    title: "Resistance per km",
    body:
      "AC resistance of the conductor per kilometre at operating temperature. Total R = r × length.",
  },
  "cable.reactance_ohm_per_km": {
    title: "Reactance per km",
    body: "Series inductive reactance per kilometre. Total X = x × length.",
  },
  "cable.length_m": {
    title: "Length",
    body:
      "Run length in metres. Solver uses (R + jX) × length / 1000 to get the total cable impedance in ohms.",
  },
  "cable.ampacity_a": {
    title: "Ampacity",
    body:
      "Continuous current rating. Used to compute the loading % on the canvas (current ÷ ampacity).",
  },

  // ---------- Load ----------
  "load.active_power_kw": {
    title: "Active power P",
    body:
      "Real power consumed in kW. Treated as a constant-PQ load in the load flow.",
  },
  "load.reactive_power_kvar": {
    title: "Reactive power Q",
    body:
      "Reactive power in kvar. Positive = inductive (lagging PF), negative = capacitive.",
  },

  // ---------- Motor ----------
  "motor.rated_kw": {
    title: "Rated shaft power",
    body: "Nameplate mechanical output power. Electrical input = rated_kw / efficiency.",
  },
  "motor.power_factor": {
    title: "Running PF",
    body: "Power factor at full load (typical operating point).",
    typical: "0.85–0.92 for medium induction motors",
  },
  "motor.efficiency": {
    title: "Efficiency",
    body: "Shaft power ÷ electrical input at full load.",
    typical: "0.90–0.96 for IE3/IE4 motors",
  },
  "motor.locked_rotor_current_ratio": {
    title: "Locked-rotor current ratio (LRC)",
    body:
      "Starting current as a multiple of full-load current with the rotor stalled (DOL). The effective starting current depends on the starting method.",
    typical: "5–7 × FLC for standard induction motors",
  },
  "motor.starting_method": {
    title: "Starting method",
    body:
      "DOL = full inrush. Star-delta = inrush divided by 3. Soft-starter = capped around 3.5× FLC. VFD = essentially full-load current (~1.1× FLC).",
  },
  "motor.starting_pf": {
    title: "Starting power factor",
    body:
      "Power factor during the locked-rotor moment. Very inductive because the rotor isn't yet producing back-EMF.",
    typical: "0.15–0.30",
  },

  // ---------- Switch ----------
  "switch.closed": {
    title: "Switch state",
    body:
      "Closed = electrical continuity (1e-6 Ω). Open = the switch terminals become separate buses, isolating downstream equipment.",
  },
  "switch.device_type": {
    title: "Device type",
    body:
      "Cosmetic only — the solver treats switch, fuse-switch, and breaker identically.",
  },

  // ---------- Fuse ----------
  "fuse.rated_current_a": {
    title: "Rated current I_n",
    body:
      "Continuous current the fuse can carry indefinitely without operating. Standard IEC 60269 R10/R20 series — pick the nearest size at or above the protected circuit's full-load current.",
    typical: "Domestic 6–32 A · Commercial 40–160 A · Industrial 200–800 A",
  },
  "fuse.fuse_class": {
    title: "Fuse class (IEC 60269)",
    body:
      "gG = general-purpose, full-range protection of cables and equipment (overload + short-circuit). gM = motor circuit protection (full-range, sized for motor loads). aM = motor backup protection only (short-circuit, no overload — must be paired with a thermal overload relay).",
  },
  "fuse.breaking_capacity_ka": {
    title: "Breaking capacity I_cu",
    body:
      "Largest prospective short-circuit current the fuse can safely interrupt without rupturing. Must exceed the fault current available at the fuse's location, otherwise coordination fails catastrophically.",
    typical: "LV gG: 50 / 80 / 100 / 120 kA · HV HRC: 20–50 kA",
  },
  "fuse.intact": {
    title: "Fuse state",
    body:
      "Intact = conducting (~0 Ω). Blown = open circuit, isolates the downstream side just like an open switch. Toggle from this dropdown.",
  },

  // ---------- Results panel concepts ----------
  "branch.s_pu": {
    title: "Apparent power in per-unit",
    body: "Power expressed on the project base.",
    formula: "S_pu = S_MVA / baseMVA",
  },
  "bus.v_conversion": {
    title: "From per-unit to volts",
    body: "The voltage in kV is the per-unit value multiplied by the bus base voltage.",
    formula: "V [kV] = V_pu × V_base [kV]",
  },
  "loadflow.mismatch": {
    title: "Power mismatch",
    body:
      "Difference between the specified P and Q at each bus and what the current voltages produce. Newton-Raphson stops when the largest mismatch is below tolerance (1e-6 pu).",
  },

  // ---------- Glossary cross-refs ----------
  "transformer.zpu": {
    title: "Per-unit impedance",
    body: "Nameplate %Z rescaled onto the project base.",
    formula: "Z_pu = (Z% / 100) × (baseMVA / ratedMVA)",
  },
  "busbar.zbase": {
    title: "Base impedance",
    body:
      "The reference impedance for this bus. All per-unit impedances seen from this bus are normalised by Z_base.",
    formula: "Z_base = V_base² / S_base",
  },
};

// ---------- Glossary drawer content ----------

export interface GlossarySection {
  id: string;
  title: string;
  paragraphs: string[];
  formula?: string;
}

export const GLOSSARY_SECTIONS: GlossarySection[] = [
  {
    id: "per-unit",
    title: "Per-unit system",
    paragraphs: [
      "Per-unit (pu) is a way of normalising electrical quantities so they're comparable across different voltage levels. Once you pick a base power (S_base) and a base voltage (V_base) for each part of the network, every impedance, current, and voltage can be expressed as a dimensionless ratio.",
      "Why bother? Two reasons. First, transformer ratios disappear — voltages on both sides of a transformer are around 1.0 pu in normal operation. Second, you can mix equipment of wildly different ratings and the impedances stay in a similar numerical range (~0.01–1.0 pu), which makes matrix conditioning much friendlier.",
      "In Power Sim, S_base is set by Base power [MVA] in the System panel. V_base for each bus is its nominal voltage. Impedances entered on nameplate bases (e.g. transformer %Z on its own MVA) are rescaled to the project base inside the solver.",
    ],
    formula: "Z_base = V_base² / S_base   ·   Z_pu = Z_Ω / Z_base",
  },
  {
    id: "bus-types",
    title: "Bus types — slack, PQ, PV",
    paragraphs: [
      "A load-flow solver fixes two of the four electrical quantities (V, θ, P, Q) at each bus and solves for the other two. Three bus types cover the cases:",
      "• Slack — V and θ are fixed (1.0 pu, 0°). P and Q are whatever the rest of the network needs them to be. There is exactly one slack bus per island.",
      "• PQ — P and Q are fixed (loads, motors, fixed-injection sources). V and θ are solved.",
      "• PV — V and P are fixed (generators, voltage-regulated sources). θ and Q are solved.",
      "In Power Sim, the first grid source becomes the slack bus. Additional grid sources become PV buses with their scheduled MW. All loads and motors are PQ.",
    ],
  },
  {
    id: "newton-raphson",
    title: "Newton-Raphson load flow",
    paragraphs: [
      "Newton-Raphson is the standard iterative method for solving the nonlinear power-flow equations. Each iteration does four things:",
      "1. Compute P and Q at every bus from the current guess of V and θ, using the network admittance matrix Y.",
      "2. Form the mismatch vector ΔP = P_spec − P_calc, ΔQ = Q_spec − Q_calc.",
      "3. Build the Jacobian J = ∂(P, Q)/∂(θ, V) and solve J·Δx = mismatch for the correction Δx.",
      "4. Apply the correction (θ ← θ + Δθ, V ← V·(1 + ΔV/V)).",
      "Repeat until max |mismatch| is below tolerance (1e-6 pu by default). After running a load flow, the Animation player at the bottom of the Results panel lets you scrub through these iterations and watch the voltages settle.",
    ],
  },
  {
    id: "branch-impedance",
    title: "Branch impedances",
    paragraphs: [
      "Transformer per-unit impedance comes from the short-circuit test, expressed as a percentage of the transformer's own ratings. To use it on the project base, rescale:  Z_pu_project = (Z% / 100) × (baseMVA / ratedMVA). Separate R and X using the X/R ratio.",
      "Cable impedance is built up from per-length values:  Z_Ω = (R + jX) [Ω/km] × length [km]. Convert to per-unit using Z_base of the bus the cable connects to:  Z_pu = Z_Ω / Z_base.",
    ],
    formula:
      "Transformer:  Z_pu = (Z% / 100) × (baseMVA / ratedMVA)\nCable:        Z_pu = (R + jX) × length / Z_base",
  },
  {
    id: "symbols",
    title: "Symbol legend (IEC style)",
    paragraphs: [
      "• Grid source — circle with an arrow, representing the upstream system. The slack reference of the project.",
      "• Busbar — solid horizontal bar. Drag the right edge to extend it.",
      "• Transformer — two interlocked circles. Vector group sits in the symbol metadata.",
      "• Cable — short line with end caps; impedance per kilometre × length.",
      "• Switch — break-contact symbol; click the symbol to toggle open/closed.",
      "• Fuse — rectangle on the wire (IEC 60617). Blown isolates the downstream side; toggle the state from the properties panel.",
      "• Load — downward arrow into ground; constant-PQ.",
      "• Motor — circle with an M.",
    ],
  },
];
