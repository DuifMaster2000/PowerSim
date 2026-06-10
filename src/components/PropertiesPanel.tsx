// =====================================================================
// Properties panel — right sidebar.
// Shows the selected component's editable parameters,
// or system settings when nothing is selected.
// =====================================================================

import { useState, useEffect } from "react";
import { useStore } from "../store";
import { COMPONENT_LABELS, STARTING_PF_DEFAULTS, STANDARD_FUSE_SIZES_A, CURVE_LABELS } from "../defaults";
import type { PowerComponent, ComponentType, MotorStartingMethod, CtParams } from "../types";
import { Explain, Info } from "./Explain";

function ConnectionPanel() {
  const selectedConnectionId = useStore((s) => s.selectedConnectionId);
  const connections = useStore((s) => s.connections);
  const components = useStore((s) => s.components);
  const removeConnection = useStore((s) => s.removeConnection);

  const conn = connections.find((c) => c.id === selectedConnectionId);
  if (!conn) return null;

  const fromComp = components.find((c) => c.id === conn.fromComponent);
  const toComp = components.find((c) => c.id === conn.toComponent);

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
      key: "curve",
      label: "Curve",
      type: "select",
      options: ["IEC-SI", "IEC-VI", "IEC-EI", "IEC-LTI", "DT"],
      optionLabels: [
        CURVE_LABELS["IEC-SI"],
        CURVE_LABELS["IEC-VI"],
        CURVE_LABELS["IEC-EI"],
        CURVE_LABELS["IEC-LTI"],
        CURVE_LABELS["DT"],
      ],
    },
    { key: "plug_setting", label: "Plug setting", unit: "×In", type: "number", step: 0.05, min: 0.1, max: 5 },
    { key: "time_multiplier", label: "Time multiplier (TMS)", type: "number", step: 0.05, min: 0.025, max: 1.5 },
    { key: "definite_time_s", label: "Definite time", unit: "s", type: "number", step: 0.05, min: 0.01 },
  ],
  ct: [
    { key: "primary_a", label: "Primary rating", unit: "A", type: "number", step: 50, min: 1 },
    {
      key: "secondary_a",
      label: "Secondary rating",
      unit: "A",
      type: "select",
      options: ["1", "5"],
    },
  ],
};

function validateField(f: FieldDef, value: number): string | null {
  if (f.type !== "number") return null;
  if (isNaN(value) || !isFinite(value)) return "Must be a valid number";
  if (f.min !== undefined && value < f.min) {
    return f.min === 0 ? "Must be ≥ 0" : `Must be > 0`;
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
  const fields = FIELDS[comp.type].filter((f) => {
    // Definite-time field only applies to the DT curve; hide it otherwise.
    if (comp.type === "relay" && f.key === "definite_time_s" && params.curve !== "DT") return false;
    return true;
  });

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
                    } else if (comp.type === "ct" && f.key === "secondary_a") {
                      updateComponentParams(comp.id, { secondary_a: parseFloat(v) } as any);
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
                  // re-seeded when starting_method changes (auto-fill default PF).
                  key={
                    comp.type === "motor" && f.key === "starting_pf"
                      ? `${comp.id}-${f.key}-${params.starting_method}`
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
          </div>
        ))}
      </div>

      {comp.type === "relay" && <RelayLinksSection relayId={comp.id} />}
      {comp.type === "ct" && <CtConductorSection ctId={comp.id} />}

      <div className="props-section">
        <button className="danger" onClick={() => removeComponent(comp.id)}>
          Delete component
        </button>
      </div>
    </aside>
  );
}

// Read-only summary of which conductor a CT is clamped onto. Resolved live
// from the CT's on_connection_id (set when dropped on a wire).
function CtConductorSection({ ctId }: { ctId: string }) {
  const components = useStore((s) => s.components);
  const connections = useStore((s) => s.connections);

  const ct = components.find((c) => c.id === ctId);
  const onId = ct ? (ct.parameters as CtParams).on_connection_id : null;
  const conn = onId ? connections.find((c) => c.id === onId) : undefined;
  const labelOf = (id: string) => components.find((c) => c.id === id)?.label ?? id;
  const bound = !!conn;
  const value = conn
    ? `${labelOf(conn.fromComponent)} → ${labelOf(conn.toComponent)}`
    : "— not on a conductor —";

  return (
    <div className="props-section">
      <h4>Measured conductor</h4>
      <div className="field">
        <label>Conductor</label>
        <input
          type="text"
          value={value}
          readOnly
          style={{ opacity: 0.7, color: bound ? undefined : "var(--warn)" }}
        />
      </div>
      <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4, margin: "4px 2px 0" }}>
        {bound
          ? "Drag a new CT onto a different wire to re-clamp; delete the wire to release this one."
          : "Drag this CT onto a power conductor so it sits inline on the wire it measures."}
      </p>
    </div>
  );
}

// Read-only summary of what a relay is wired to via control wires: which CT
// feeds it current, and which breaker it trips. Resolved live from connections.
function RelayLinksSection({ relayId }: { relayId: string }) {
  const getRelayLinks = useStore((s) => s.getRelayLinks);
  // Re-derive when components/connections change.
  useStore((s) => s.connections);
  const links = getRelayLinks(relayId);

  const Row = ({ label, value, ok }: { label: string; value: string; ok: boolean }) => (
    <div className="field">
      <label>{label}</label>
      <input
        type="text"
        value={value}
        readOnly
        style={{ opacity: 0.7, color: ok ? undefined : "var(--warn)" }}
      />
    </div>
  );

  return (
    <div className="props-section">
      <h4>Protection links</h4>
      <Row
        label="CT"
        value={links.ctLabel ? `${links.ctLabel} (${links.ct?.primary_a}/${links.ct?.secondary_a} A)` : "— none wired —"}
        ok={!!links.ctId}
      />
      <Row
        label="Trips breaker"
        value={links.breakerLabel ?? "— none wired —"}
        ok={!!links.breakerId}
      />
      <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4, margin: "4px 2px 0" }}>
        Draw a dashed control wire CT → relay → breaker to complete the chain.
      </p>
    </div>
  );
}
