// =====================================================================
// Custom React Flow node components.
// Each is a small wrapper around our visual node container + symbol.
// =====================================================================

import { useState, useRef, useEffect } from "react";
import { Handle, Position, NodeProps, NodeResizer } from "@xyflow/react";
import { ComponentSymbol } from "./symbols";
import { useStore } from "../store";
import type { ComponentType, BusbarParams, BusResult, BranchResult } from "../types";

interface NodeData {
  componentType: ComponentType;
  label: string;
  readout?: string;
  readoutTone?: "ok" | "warn" | "bad";
  isSelected?: boolean; // store-driven; more reliable than NodeProps.selected
  isFault?: boolean;
  switchClosed?: boolean;
  fuseIntact?: boolean;
  busLengthPx?: number;
  ratioText?: string; // transformer: "11 kV / 0.4 kV"
  baseOverlay?: string; // Explain-mode-only: e.g. "base: 11² / 100 = 1.21 Ω"
  gradingColor?: string; // set when the component is in the grading study — matches its curve colour
}

// We register a single generic node renderer in React Flow and dispatch on the
// componentType — easier than registering 7 separate node types.
export function GenericNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as NodeData;
  const toggleSwitch = useStore((s) => s.toggleSwitch);
  const updateComponentParams = useStore((s) => s.updateComponentParams);
  const updateComponentLabel = useStore((s) => s.updateComponentLabel);
  const resultsTab = useStore((s) => s.resultsTab);

  // Inline label editing: double-click the label to rename in place.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== d.label) updateComponentLabel(id, next);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(d.label);
    setEditing(false);
  };

  const onSymbolClick = (e: React.MouseEvent) => {
    // While the Grading tab is open, a click adds the breaker to the grading
    // study (handled by onNodeClick) instead of operating it.
    if (d.componentType === "switch" && resultsTab !== "grading") {
      e.stopPropagation();
      toggleSwitch(id);
    }
  };

  const tone = d.readoutTone ? d.readoutTone : "ok";

  // Terminal placement varies per component
  const terminals = getTerminals(d.componentType);

  const className = [
    "node",
    d.componentType,
    (d.isSelected || selected) ? "selected" : "",
    d.isFault ? "fault" : "",
    d.componentType === "switch" && d.switchClosed === false ? "open" : "",
    d.componentType === "fuse" && d.fuseIntact === false ? "blown" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const isBusbar = d.componentType === "busbar";
  const busLength = d.busLengthPx ?? 200;
  const symbolSize =
    d.componentType === "transformer" ? 52 :
    d.componentType === "relay" ? 22 :
    36;

  return (
    <div className={className} style={isBusbar ? { width: busLength } : undefined}>
      {d.gradingColor && (
        <div
          className="node-grading-dot"
          style={{ background: d.gradingColor }}
          title="In grading study — its curve uses this colour"
        />
      )}
      {isBusbar && (
        <NodeResizer
          isVisible={selected}
          minWidth={80}
          maxWidth={1200}
          // height stays auto-driven by content
          shouldResize={(_e, params) => {
            // Allow only horizontal resize: ignore N/S/NE/NW/SE/SW handles
            return params.direction[1] === 0;
          }}
          onResize={(_e, params) => {
            updateComponentParams<"busbar">(id, { length_px: Math.round(params.width) });
          }}
          lineStyle={{ borderColor: "var(--accent)" }}
          handleStyle={{
            width: 8,
            height: 8,
            background: "var(--accent)",
            border: "1px solid var(--bg)",
            borderRadius: 2,
          }}
        />
      )}

      {terminals.map((t, i) => (
        <Handle
          key={`${t.kind}-${i}`}
          id={t.id}
          type={t.kind === "target" ? "target" : "source"}
          position={t.position}
          isConnectable={true}
        />
      ))}

      {!isBusbar && (
        <div className="node-symbol" onClick={onSymbolClick}>
          <ComponentSymbol
            type={d.componentType}
            size={symbolSize}
            state={{ closed: d.switchClosed, intact: d.fuseIntact }}
          />
        </div>
      )}
      {isBusbar && <div className="node-symbol" />}
      {editing ? (
        <input
          ref={inputRef}
          className="node-label-edit nodrag"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className="node-label"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setDraft(d.label);
            setEditing(true);
          }}
          title="Double-click to rename"
        >
          {d.label}
        </div>
      )}
      {d.ratioText && !editing && (
        <div className="node-ratio">{d.ratioText}</div>
      )}
      {d.readout && (
        <div className={`node-readout ${tone === "ok" ? "" : tone}`}>{d.readout}</div>
      )}
      {d.baseOverlay && (
        <div className="node-base-overlay">{d.baseOverlay}</div>
      )}
    </div>
  );
}

// ---------- Terminal layout per component type ----------

interface Terminal {
  id: string;
  kind: "source" | "target";
  position: Position;
}

function getTerminals(type: ComponentType): Terminal[] {
  switch (type) {
    case "grid_source":
      // Single bottom terminal (source feeds the network)
      return [{ id: "out", kind: "source", position: Position.Bottom }];
    case "busbar":
      // Logical single terminal but we expose top + bottom for flexible connections
      return [
        { id: "top", kind: "target", position: Position.Top },
        { id: "bottom", kind: "source", position: Position.Bottom },
      ];
    case "transformer":
      return [
        { id: "primary", kind: "target", position: Position.Top },
        { id: "secondary", kind: "source", position: Position.Bottom },
      ];
    case "cable":
      return [
        { id: "from", kind: "target", position: Position.Top },
        { id: "to", kind: "source", position: Position.Bottom },
      ];
    case "switch":
    case "fuse":
      return [
        { id: "in", kind: "target", position: Position.Top },
        { id: "out", kind: "source", position: Position.Bottom },
      ];
    case "load":
      return [{ id: "in", kind: "target", position: Position.Top }];
    case "motor":
      return [{ id: "in", kind: "target", position: Position.Top }];
    case "relay":
      // Control device: reads a CT (a property of a wire, chosen in its
      // properties) and trips a breaker over a single control wire.
      return [{ id: "trip", kind: "source", position: Position.Bottom }];
  }
}

// ---------- Synthetic-bus node ----------
// Dot placed at the midpoint of a wire (or chain of wires) that forms an
// electrical bus without any explicit busbar component. Clickable to select
// as a short-circuit fault target.

interface SyntheticBusData {
  label: string;
  readout?: string;
  tone?: "ok" | "warn" | "bad";
  isFault?: boolean;
  isSelected?: boolean;
}

export function SyntheticBusNode({ data, selected }: NodeProps) {
  const d = data as unknown as SyntheticBusData;
  const tone = d.tone ?? "ok";
  const className = [
    "synth-bus",
    (selected || d.isSelected) ? "selected" : "",
    d.isFault ? "fault" : "",
    tone !== "ok" ? `tone-${tone}` : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={className} title={d.isFault ? "Selected as fault bus" : "Click to select as fault bus"}>
      <div className="synth-bus-dot" />
      <div className="synth-bus-label">{d.label}</div>
      {d.readout && <div className={`synth-bus-readout ${tone}`}>{d.readout}</div>}
    </div>
  );
}

// Re-export for legacy import surface; unused locally now.
export type { BusbarParams };

// ---------- Helpers to format readouts from results ----------

export function formatBusReadout(r: BusResult | undefined): {
  text: string;
  tone: "ok" | "warn" | "bad";
} | undefined {
  if (!r) return undefined;
  const pu = r.voltagePu;
  let tone: "ok" | "warn" | "bad" = "ok";
  if (pu < 0.9 || pu > 1.1) tone = "bad";
  else if (pu < 0.95 || pu > 1.05) tone = "warn";
  return { text: `${r.voltageKv.toFixed(2)} kV · ${(pu * 100).toFixed(1)}%`, tone };
}

export function formatBranchReadout(r: BranchResult | undefined): {
  text: string;
  tone: "ok" | "warn" | "bad";
} | undefined {
  if (!r) return undefined;
  const lp = r.loadingPercent;
  let tone: "ok" | "warn" | "bad" = "ok";
  if (lp > 100) tone = "bad";
  else if (lp > 80) tone = "warn";
  const text =
    lp > 0
      ? `${r.currentA.toFixed(0)} A · ${lp.toFixed(0)}%`
      : `${r.currentA.toFixed(0)} A`;
  return { text, tone };
}
