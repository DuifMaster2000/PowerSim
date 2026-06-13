// =====================================================================
// Component palette — left sidebar.
// Drag from here onto the canvas to add a component.
// =====================================================================

import type { ComponentType } from "../types";
import { COMPONENT_LABELS } from "../defaults";
import { ComponentSymbol } from "./symbols";

const ORDER: ComponentType[] = [
  "grid_source",
  "busbar",
  "transformer",
  "cable",
  "switch",
  "fuse",
  "load",
  "motor",
  "relay",
];

function PaletteItem({ type }: { type: ComponentType }) {
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/power-sim-type", type);
    e.dataTransfer.effectAllowed = "move";
  };
  return (
    <div className="palette-item" draggable onDragStart={onDragStart}>
      <div className="palette-item-icon">
        {type === "busbar" ? (
          <div style={{ width: 24, height: 4, background: "currentColor", borderRadius: 2 }} />
        ) : (
          <ComponentSymbol type={type} size={24} />
        )}
      </div>
      <div className="palette-item-label">{COMPONENT_LABELS[type]}</div>
    </div>
  );
}

export function Palette() {
  return (
    <aside className="palette">
      <h3>Components</h3>
      {ORDER.map((type) => (
        <PaletteItem key={type} type={type} />
      ))}
      <h3 style={{ marginTop: 24 }}>Tip</h3>
      <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, padding: "0 4px" }}>
        Drag onto the canvas. Connect by dragging from one terminal dot to another. Busbars connect
        to everything; transformers, cables, switches and fuses can sit inline — a breaker right at a
        transformer's terminals is fine, no busbar needed in between.
      </p>
    </aside>
  );
}
