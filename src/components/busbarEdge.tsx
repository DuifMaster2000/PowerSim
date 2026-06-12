// =====================================================================
// BusbarEdge: custom React Flow edge that, when one end is a busbar,
// snaps that end's X coordinate to the X of the other component.
// Produces perpendicular drop lines for a clean SLD look.
// Also renders a flow-result label at the midpoint when present.
// =====================================================================

import { BaseEdge, EdgeLabelRenderer, EdgeProps, useInternalNode } from "@xyflow/react";
import { useStore } from "../store";
import type { BusbarParams, CtParams } from "../types";
import { CtGlyph } from "./symbols";

const DEFAULT_NON_BUS_WIDTH = 80;

interface EdgeData {
  label?: string;
  tone?: "ok" | "warn" | "bad" | "live";
  ct?: CtParams;
}

export function BusbarEdge(props: EdgeProps) {
  const { id, source, target, sourceX, sourceY, targetX, targetY, style, markerEnd, markerStart, selected, data } =
    props;
  const ed = data as EdgeData | undefined;

  const components = useStore((s) => s.components);
  const selectConnection = useStore((s) => s.selectConnection);
  const srcNode = useInternalNode(source);
  const tgtNode = useInternalNode(target);

  const srcComp = components.find((c) => c.id === source);
  const tgtComp = components.find((c) => c.id === target);

  let sx = sourceX;
  let tx = targetX;

  const centerX = (compId: string, fallbackHandleX: number): number => {
    const comp = components.find((c) => c.id === compId);
    if (!comp) return fallbackHandleX;
    const node = compId === source ? srcNode : tgtNode;
    const width =
      node?.measured?.width ??
      (comp.type === "busbar"
        ? (comp.parameters as BusbarParams).length_px ?? 200
        : DEFAULT_NON_BUS_WIDTH);
    return comp.position.x + width / 2;
  };

  const clampToBusbar = (busCompId: string, x: number): number => {
    const bus = components.find((c) => c.id === busCompId);
    if (!bus || bus.type !== "busbar") return x;
    const len = (bus.parameters as BusbarParams).length_px ?? 200;
    const left = bus.position.x + 4;
    const right = bus.position.x + len - 4;
    return Math.max(left, Math.min(right, x));
  };

  if (srcComp?.type === "busbar" && tgtComp?.type !== "busbar") {
    sx = clampToBusbar(source, centerX(target, targetX));
  } else if (tgtComp?.type === "busbar" && srcComp?.type !== "busbar") {
    tx = clampToBusbar(target, centerX(source, sourceX));
  }

  const path =
    Math.abs(sx - tx) < 0.5
      ? `M ${sx} ${sourceY} L ${tx} ${targetY}`
      : `M ${sx} ${sourceY} L ${sx} ${(sourceY + targetY) / 2} L ${tx} ${(sourceY + targetY) / 2} L ${tx} ${targetY}`;

  const midX = (sx + tx) / 2;
  const midY = (sourceY + targetY) / 2;
  const toneClass = ed?.tone ? `tone-${ed.tone}` : "";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={style}
        markerEnd={markerEnd}
        markerStart={markerStart}
        className={selected ? "selected" : undefined}
      />
      {ed?.ct && (
        <EdgeLabelRenderer>
          <div
            className={`edge-ct-badge ${selected ? "selected" : ""}`}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${midX}px, ${midY - (ed?.label ? 15 : 0)}px)`,
              pointerEvents: "all",
            }}
            title={`CT ${ed.ct.primary_a}/${ed.ct.secondary_a} A — click to edit`}
            onClick={(e) => {
              e.stopPropagation();
              selectConnection(id);
            }}
          >
            <CtGlyph size={16} />
            <span>{ed.ct.primary_a}/{ed.ct.secondary_a}</span>
          </div>
        </EdgeLabelRenderer>
      )}
      {ed?.label && (
        <EdgeLabelRenderer>
          <div
            className={`edge-readout ${toneClass}`}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)`,
              pointerEvents: "none",
            }}
          >
            {ed.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
