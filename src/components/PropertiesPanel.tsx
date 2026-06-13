// =====================================================================
// Properties panel — right sidebar.
// Shows the selected component's editable parameters,
// or system settings when nothing is selected.
// =====================================================================

import { useState, useEffect } from "react";
import { useStore, isControlConnection } from "../store";
import { COMPONENT_LABELS, STARTING_PF_DEFAULTS, STANDARD_FUSE_SIZES_A, CURVE_LABELS, DEFAULT_CT_PARAMS, RELAY_MODELS } from "../defaults";
import type { PowerComponent, ComponentType, MotorStartingMethod, RelayParams, RelayModel, IdmtCurve } from "../types";
import { Explain, Info } from "./Explain";

function ConnectionPanel() {
  const selectedConnectionId = useStore((s) => s.selectedConnectionId);
  const connections = useStore((s) => s.connections);
  const components = useStore((s) => s.components);
  const removeConnection = useStore((s) => s.removeConnection);
  const setConnectionCt = useStore((s) => s.setConnectionCt);

  const conn = connections.find((c) => c.id === selectedConnectionId);
  if (!conn) return null;

  const fromComp = components.find((c) => c.id === conn.fromComponent);
  const toComp = components.find((c) => c.id === conn.toComponent);

  // CTs only make sense on a power conductor, not a relay's control wire.
  const isControl = isControlConnection(conn, components);
  const ct = conn.ct ?? null;

  return (
    <aside className="props">
      <div className="props-header">
        <h2>Connection</h2>
        <span className="badge">WIRE</span>
      </div>
      <div className="props-section">
        <h4>From</h4>
        <div className="field">
          <label>Component</label>
          <input type="text" value={fromComp?.label ?? conn.fromComponent} readOnly style={{ opacity: 0.6 }} />
        </div>
        <div className="field">
          <label>Terminal</label>
          <input type="text" value={conn.fromTerminal} readOnly style={{ opacity: 0.6 }} />
        </div>
      </div>
      <div className="props-section">
        <h4>To</h4>
        <div className="field">
          <label>Component</label>
          <input type="text" value={toComp?.label ?? conn.toComponent} readOnly style={{ opacity: 0.6 }} />
        </div>
        <div className="field">
          <label>Terminal</label>
          <input type="text" value={conn.toTerminal} readOnly style={{ opacity: 0.6 }} />
        </div>
      </div>

      {!isControl && (
        <div className="props-section">
          <div className="field">
            <h4 style={{ flex: 1 }}>Current transformer</h4>
            <select
              style={{ width: 90 }}
              value={ct ? "yes" : "no"}
              onChange={(e) =>
                setConnectionCt(conn.id, e.target.value === "yes" ? { ...DEFAULT_CT_PARAMS } : null)
              }
            >
              <option value="no">None</option>
              <option value="yes">Fitted</option>
            </select>
          </div>
          {ct && (
            <>
              <div className="field">
                <label>Primary rating [A]</label>
                <input
                  style={{ width: 110 }}
                  type="number"
                  step={50}
                  min={1}
                  defaultValue={ct.primary_a}
                  key={`${conn.id}-ct-primary`}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (isFinite(v) && v > 0) setConnectionCt(conn.id, { ...ct, primary_a: v });
                  }}
                />
              </div>
              <div className="field">
                <label>Secondary rating [A]</label>
                <select
                  style={{ width: 110 }}
                  value={String(ct.secondary_a)}
                  onChange={(e) =>
                    setConnectionCt(conn.id, { ...ct, secondary_a: parseFloat(e.target.value) as 1 | 5 })
                  }
                >
                  <option value="1">1</option>
                  <option value="5">5</option>
                </select>
              </div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4, margin: "4px 2px 0" }}>
                Select a relay and pick this wire as its measured CT to drive its pickup and fault marker.
              </p>
            </>
          )}
        </div>
      )}

      <div className="props-section">
        <button className="danger" onClick={() => removeConnection(conn.id)}>
          Delete connection
        </button>
      </div>
    </aside>
  );
}

interface FieldDef {
  key: string;
  label: string;
  unit?: string;
  type?: "number" | "text" | "select" | "boolean";
  options?: string[];
  optionLabels?: string[]; // display text per option (parallel to options); defaults to options
  step?: number;
  min?: number;
  max?: number;
  hint?: string; // small muted note rendered under the field
}

const FIELDS: { [K in ComponentType]: FieldDef[] } = {
  grid_source: [
    { key: "nominal_voltage_kv", label: "Nominal voltage", unit: "kV", type: "number", step: 0.1, min: 0.001 },
    { key: "short_circuit_mva", label: "Short-circuit", unit: "MVA", type: "number", step: 10, min: 0.001 },
    { key: "xr_ratio", label: "X/R ratio", type: "number", step: 0.5, min: 0.001 },
    { key: "scheduled_mw", label: "Sched. injection", unit: "MW", type: "number", step: 1 },
  ],
  busbar: [
    { key: "nominal_voltage_kv", label: "Nominal voltage", unit: "kV", type: "number", step: 0.1, min: 0.001 },
    { key: "length_px", label: "Bus length", unit: "px", type: "number", step: 20, min: 80, max: 1200 },
  ],
  transformer: [
    { key: "rated_mva", label: "Rated", unit: "MVA", type: "number", step: 0.1, min: 0.001 },
    { key: "primary_kv", label: "Primary", unit: "kV", type: "number", step: 0.1, min: 0.001 },
    { key: "secondary_kv", label: "Secondary", unit: "kV", type: "number", step: 0.1, min: 0.001 },
    { key: "impedance_percent", label: "Impedance", unit: "%", type: "number", step: 0.1, min: 0.001 },
    { key: "xr_ratio", label: "X/R ratio", type: "number", step: 0.5, min: 0.001 },
    { key: "vector_group", label: "Vector group", type: "text" },
  ],
  cable: [
    { key: "resistance_ohm_per_km", label: "R", unit: "Ω/km", type: "number", step: 0.01, min: 0 },
    { key: "reactance_ohm_per_km", label: "X", unit: "Ω/km", type: "number", step: 0.01, min: 0 },
    { key: "length_m", label: "Length", unit: "m", type: "number", step: 1, min: 0.1 },
    { key: "ampacity_a", label: "Ampacity", unit: "A", type: "number", step: 10, min: 1 },
    { key: "csa_mm2", label: "Cross-section", unit: "mm²", type: "number", step: 5, min: 1 },
  ],
  load: [
    { key: "active_power_kw", label: "Active P", unit: "kW", type: "number", step: 1, min: 0 },
    { key: "reactive_power_kvar", label: "Reactive Q", unit: "kvar", type: "number", step: 1 },
  ],
  motor: [
    { key: "rated_kw", label: "Rated", unit: "kW", type: "number", step: 1, min: 0.001 },
    { key: "power_factor", label: "Power factor", type: "number", step: 0.01, min: 0.01, max: 1.0 },
    { key: "efficiency", label: "Efficiency", type: "number", step: 0.01, min: 0.01, max: 1.0 },
    { key: "locked_rotor_current_ratio", label: "LRC ratio", type: "number", step: 0.1, min: 1 },
    {
      key: "starting_method",
      label: "Starting method",
      type: "select",
      options: ["DOL", "star-delta", "soft-starter", "VFD"],
    },
    { key: "starting_pf", label: "Starting PF", type: "number", step: 0.01, min: 0.05, max: 1.0 },
    { key: "starting_time_s", label: "Start time", unit: "s", type: "number", step: 0.5, min: 0.1, max: 120 },
  ],
  switch: [
    { key: "closed", label: "State", type: "boolean" },
    {
      key: "device_type",
      label: "Device type",
      type: "select",
      options: ["switch", "fuse-switch", "breaker"],
    },
  ],
  fuse: [
    {
      key: "rated_current_a",
      label: "Rated current",
      unit: "A",
      type: "select",
      options: STANDARD_FUSE_SIZES_A.map((n) => String(n)),
    },
    {
      key: "fuse_class",
      label: "Class",
      type: "select",
      options: ["gG", "gM", "aM"],
    },
    {
      key: "breaking_capacity_ka",
      label: "Breaking capacity",
      unit: "kA",
      type: "number",
      step: 5,
      min: 1,
    },
    { key: "intact", label: "State", type: "boolean" },
  ],
  relay: [
    {
      key: "relay_model",
      label: "Relay type",
      type: "select",
      options: Object.keys(RELAY_MODELS),
      optionLabels: Object.values(RELAY_MODELS).map((m) => m.label),
    },
    // curve / plug_setting / time_multiplier / definite_time_s ranges and the
    // available curve sets are filled in per relay model — see applyRelayModel.
    { key: "curve", label: "3I> curve", type: "select", options: [] },
    { key: "plug_setting", label: "3I> pickup", unit: "×In", type: "number", step: 0.05 },
    { key: "time_multiplier", label: "3I> TMS", type: "number", step: 0.05 },
    { key: "definite_time_s", label: "3I> time", unit: "s", type: "number", step: 0.05 },
    // High stage 3I>> (PHHPTOC) — multi-stage models only.
    { key: "stage2_enabled", label: "High stage (3I>>)", type: "boolean" },
    { key: "stage2_curve", label: "3I>> curve", type: "select", options: [] },
    { key: "stage2_pickup", label: "3I>> pickup", unit: "×In", type: "number", step: 0.1, min: 0.1, max: 40 },
    { key: "stage2_tms", label: "3I>> TMS", type: "number", step: 0.05, min: 0.05, max: 15 },
    { key: "stage2_time_s", label: "3I>> time", unit: "s", type: "number", step: 0.05, min: 0.04, max: 200 },
    // Instantaneous stage 3I>>> (PHIPTOC) — definite time only.
    { key: "stage3_enabled", label: "Inst. stage (3I>>>)", type: "boolean" },
    { key: "stage3_pickup", label: "3I>>> pickup", unit: "×In", type: "number", step: 0.5, min: 1, max: 40 },
    { key: "stage3_time_s", label: "3I>>> time", unit: "s", type: "number", step: 0.01, min: 0.02, max: 200 },
    // Thermal overload element (49) — base current taken from the CT rating.
    { key: "thermal_enabled", label: "Thermal (49)", type: "boolean" },
    { key: "thermal_tau_min", label: "Time constant τ", unit: "min", type: "number", step: 1, min: 1, max: 600 },
    { key: "thermal_k", label: "Overload factor k", type: "number", step: 0.05, min: 1, max: 1.5 },
    { key: "thermal_base_a", label: "Base current Ib", unit: "A", type: "number", step: 10, min: 0, hint: "0 = auto (CT primary)" },
  ],
};

// Constrain the relay fields to what the selected hardware model accepts.
function applyRelayModel(fields: FieldDef[], model: RelayModel): FieldDef[] {
  const spec = RELAY_MODELS[model] ?? RELAY_MODELS.generic;
  return fields.map((f) => {
    switch (f.key) {
      case "curve":
      case "stage2_curve":
        return { ...f, options: spec.curves, optionLabels: spec.curves.map((c) => CURVE_LABELS[c]) };
      case "plug_setting":
        return { ...f, min: spec.plugMin, max: spec.plugMax, step: spec.plugStep };
      case "time_multiplier":
        return { ...f, min: spec.tmsMin, max: spec.tmsMax };
      case "definite_time_s":
        return { ...f, min: spec.dtMin, max: spec.dtMax };
      default:
        return f;
    }
  });
}

// Which relay fields are visible, given the model and the current params.
// Stage 2/3 exist only on multi-stage models; per-stage timing fields follow
// the stage's curve type (TMS for IDMT curves, time for DT).
function relayFieldVisible(f: FieldDef, params: Record<string, unknown>): boolean {
  const model = (params.relay_model as RelayModel) ?? "generic"; // legacy pre-v0.10 relays
  const multiStage = (RELAY_MODELS[model] ?? RELAY_MODELS.generic).stages === 3;
  if (f.key === "definite_time_s" && params.curve !== "DT") return false;
  if (f.key === "time_multiplier" && params.curve === "DT") return false;
  if (f.key.startsWith("stage") && !multiStage) return false;
  if (["stage2_curve", "stage2_pickup", "stage2_tms", "stage2_time_s"].includes(f.key) && !params.stage2_enabled) return false;
  if (f.key === "stage2_tms" && params.stage2_curve === "DT") return false;
  if (f.key === "stage2_time_s" && params.stage2_curve !== "DT") return false;
  if (["stage3_pickup", "stage3_time_s"].includes(f.key) && !params.stage3_enabled) return false;
  if (f.key.startsWith("thermal") && !multiStage) return false;
  if (["thermal_tau_min", "thermal_k", "thermal_base_a"].includes(f.key) && !params.thermal_enabled) return false;
  return true;
}

function validateField(f: FieldDef, value: number): string | null {
  if (f.type !== "number") return null;
  if (isNaN(value) || !isFinite(value)) return "Must be a valid number";
  if (f.min !== undefined && value < f.min) {
    return f.min === 0 ? "Must be ≥ 0" : `Must be ≥ ${f.min}`;
  }
  if (f.max !== undefined && value > f.max) return `Must be ≤ ${f.max}`;
  return null;
}

export function PropertiesPanel() {
  const selectedConnectionId = useStore((s) => s.selectedConnectionId);
  const selectedId = useStore((s) => s.selectedComponentId);
  const components = useStore((s) => s.components);
  const updateComponentParams = useStore((s) => s.updateComponentParams);
  const updateComponentLabel = useStore((s) => s.updateComponentLabel);
  const removeComponent = useStore((s) => s.removeComponent);
  const baseMva = useStore((s) => s.baseMva);
  const frequencyHz = useStore((s) => s.frequencyHz);
  const setBaseMva = useStore((s) => s.setBaseMva);
  const setFrequencyHz = useStore((s) => s.setFrequencyHz);

  // Local error state: fieldKey → error message
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Clear errors when selection changes
  const comp = components.find((c) => c.id === selectedId);
  useEffect(() => { setFieldErrors({}); }, [selectedId]);

  if (selectedConnectionId) return <ConnectionPanel />;

  if (!comp) {
    return (
      <aside className="props">
        <div className="props-header">
          <h2>System</h2>
          <span className="badge">PROJECT</span>
        </div>
        <div className="props-section">
          <h4>
            Per-unit base
            <Info topic="busbar.zbase" />
          </h4>
          <div className="field">
            <label>
              <Explain topic="busbar.zbase">Base power [MVA]</Explain>
            </label>
            <input
              type="number"
              value={baseMva}
              onChange={(e) => setBaseMva(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="field">
            <label>Frequency [Hz]</label>
            <input
              type="number"
              value={frequencyHz}
              onChange={(e) => setFrequencyHz(parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
        <div className="props-empty">
          Select a component on the canvas to edit its parameters.
        </div>
      </aside>
    );
  }

  const params = comp.parameters as unknown as Record<string, unknown>;
  let fields = FIELDS[comp.type];
  if (comp.type === "relay") {
    fields = applyRelayModel(
      fields.filter((f) => relayFieldVisible(f, params)),
      (params.relay_model as RelayModel) ?? "generic", // legacy pre-v0.10 relays
    );
  }

  const handleNumberChange = (f: FieldDef, raw: string) => {
    const val = parseFloat(raw);
    const err = validateField(f, val);
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (err) next[f.key] = err;
      else delete next[f.key];
      return next;
    });
    if (!err) {
      updateComponentParams(comp.id, { [f.key]: val } as any);
    }
  };

  return (
    <aside className="props">
      <div className="props-header">
        <h2>{COMPONENT_LABELS[comp.type]}</h2>
        <span className="badge">{comp.type.toUpperCase()}</span>
      </div>
      <div className="props-section">
        <h4>Identity</h4>
        <div className="field">
          <label>Label</label>
          <input
            type="text"
            value={comp.label}
            onChange={(e) => updateComponentLabel(comp.id, e.target.value)}
          />
        </div>
        <div className="field">
          <label>ID</label>
          <input type="text" value={comp.id} readOnly style={{ opacity: 0.6 }} />
        </div>
      </div>

      <div className="props-section">
        <h4>Parameters</h4>
        {fields.map((f) => (
          <div className="field" key={f.key} style={{ flexDirection: "column", alignItems: "stretch", gap: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ flex: 1 }}>
                <Explain topic={`${comp.type}.${f.key}`} fallbackTopic={f.key}>
                  {f.label}
                </Explain>{" "}
                {f.unit && <span style={{ color: "var(--text-muted)" }}>[{f.unit}]</span>}
              </label>
              {f.type === "boolean" ? (
                <select
                  style={{ width: 110 }}
                  value={params[f.key] ? "true" : "false"}
                  onChange={(e) =>
                    updateComponentParams(comp.id, { [f.key]: e.target.value === "true" } as any)
                  }
                >
                  {comp.type === "fuse" && f.key === "intact" ? (
                    <>
                      <option value="true">Intact</option>
                      <option value="false">Blown</option>
                    </>
                  ) : comp.type === "relay" ? (
                    <>
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </>
                  ) : (
                    <>
                      <option value="true">Closed</option>
                      <option value="false">Open</option>
                    </>
                  )}
                </select>
              ) : f.type === "select" ? (
                <select
                  style={{ width: 110 }}
                  value={String(params[f.key])}
                  onChange={(e) => {
                    const v = e.target.value;
                    // Picking a starting method also snaps starting_pf to the
                    // plausible default for that method (user can still tune it).
                    if (comp.type === "motor" && f.key === "starting_method") {
                      const method = v as MotorStartingMethod;
                      updateComponentParams(comp.id, {
                        starting_method: method,
                        starting_pf: STARTING_PF_DEFAULTS[method],
                      } as any);
                    } else if (comp.type === "fuse" && f.key === "rated_current_a") {
                      updateComponentParams(comp.id, { rated_current_a: parseFloat(v) } as any);
                    } else if (comp.type === "relay" && f.key === "relay_model") {
                      // Switching hardware clamps the settings into the new
                      // model's ranges, drops curves it doesn't offer, and
                      // switches off stages the model doesn't have (otherwise
                      // hidden-but-enabled stages would still shape the curve).
                      const spec = RELAY_MODELS[v as RelayModel];
                      const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
                      updateComponentParams(comp.id, {
                        relay_model: v as RelayModel,
                        plug_setting: clamp(params.plug_setting as number, spec.plugMin, spec.plugMax),
                        time_multiplier: clamp(params.time_multiplier as number, spec.tmsMin, spec.tmsMax),
                        definite_time_s: clamp(params.definite_time_s as number, spec.dtMin, spec.dtMax),
                        ...(spec.curves.includes(params.curve as IdmtCurve) ? {} : { curve: "IEC-SI" as IdmtCurve }),
                        ...(spec.stages === 1 ? { stage2_enabled: false, stage3_enabled: false, thermal_enabled: false } : {}),
                        ...(spec.curves.includes((params.stage2_curve as IdmtCurve) ?? "DT") ? {} : { stage2_curve: "DT" as IdmtCurve }),
                      } as any);
                    } else {
                      updateComponentParams(comp.id, { [f.key]: v } as any);
                    }
                  }}
                >
                  {f.options!.map((o, oi) => (
                    <option key={o} value={o}>
                      {f.optionLabels ? f.optionLabels[oi] : o}
                    </option>
                  ))}
                </select>
              ) : f.type === "text" ? (
                <input
                  style={{ width: 110 }}
                  type="text"
                  value={params[f.key] as string}
                  onChange={(e) =>
                    updateComponentParams(comp.id, { [f.key]: e.target.value } as any)
                  }
                />
              ) : (
                <input
                  style={{
                    width: 110,
                    borderColor: fieldErrors[f.key] ? "var(--bad)" : undefined,
                    outline: fieldErrors[f.key] ? "1px solid var(--bad)" : undefined,
                  }}
                  type="number"
                  step={f.step ?? "any"}
                  defaultValue={params[f.key] as number}
                  // Uncontrolled input — include in the key any other field whose
                  // change should *re-seed* this input's value. starting_pf gets
                  // re-seeded when starting_method changes (auto-fill default PF);
                  // relay settings get re-seeded when the model clamps them.
                  key={
                    comp.type === "motor" && f.key === "starting_pf"
                      ? `${comp.id}-${f.key}-${params.starting_method}`
                      : comp.type === "relay"
                        ? `${comp.id}-${f.key}-${params.relay_model}`
                        : `${comp.id}-${f.key}`
                  }
                  onChange={(e) => handleNumberChange(f, e.target.value)}
                />
              )}
            </div>
            {fieldErrors[f.key] && (
              <span style={{ color: "var(--bad)", fontSize: 11, paddingLeft: 2 }}>
                {fieldErrors[f.key]}
              </span>
            )}
            {!fieldErrors[f.key] && f.hint && (
              <span style={{ color: "var(--text-muted)", fontSize: 10, paddingLeft: 2 }}>
                {f.hint}
              </span>
            )}
          </div>
        ))}
      </div>

      {comp.type === "relay" && <RelayLinksSection relayId={comp.id} />}

      <div className="props-section">
        <button className="danger" onClick={() => removeComponent(comp.id)}>
          Delete component
        </button>
      </div>
    </aside>
  );
}

// Relay protection links: a dropdown to pick which CT-equipped wire the relay
// measures, plus a read-only view of the breaker it trips (via control wire).
function RelayLinksSection({ relayId }: { relayId: string }) {
  const components = useStore((s) => s.components);
  const connections = useStore((s) => s.connections);
  const getRelayLinks = useStore((s) => s.getRelayLinks);
  const updateComponentParams = useStore((s) => s.updateComponentParams);
  const links = getRelayLinks(relayId);

  const relay = components.find((c) => c.id === relayId);
  const measuredId = relay ? (relay.parameters as RelayParams).measured_connection_id : null;

  const labelOf = (id: string) => components.find((c) => c.id === id)?.label ?? id;
  const ctWires = connections.filter((c) => c.ct);

  return (
    <div className="props-section">
      <h4>Protection links</h4>
      <div className="field">
        <label>Measured CT</label>
        <select
          style={{ width: 150 }}
          value={measuredId ?? ""}
          onChange={(e) =>
            updateComponentParams(relayId, { measured_connection_id: e.target.value || null } as any)
          }
        >
          <option value="">— none —</option>
          {ctWires.map((c) => (
            <option key={c.id} value={c.id}>
              {labelOf(c.fromComponent)} → {labelOf(c.toComponent)} ({c.ct!.primary_a}/{c.ct!.secondary_a} A)
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Trips breaker</label>
        <input
          type="text"
          value={links.breakerLabel ?? "— none wired —"}
          readOnly
          style={{ opacity: 0.7, color: links.breakerId ? undefined : "var(--warn)" }}
        />
      </div>
      <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4, margin: "4px 2px 0" }}>
        {ctWires.length === 0
          ? "Add a CT to a power wire first (select the wire), then pick it here. Draw a dashed control wire to the breaker."
          : "Pick the CT this relay reads, then draw a dashed control wire to the breaker it trips."}
      </p>
    </div>
  );
}
