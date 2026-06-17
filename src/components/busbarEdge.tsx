// =====================================================================
// BusbarEdge: custom React Flow edge that, when one end is a busbar,
// snaps that end's X coordinate to the X of the other component.
// Produces perpendicular drop lines for a clean SLD look.
// Also renders a flow-result label at the midpoint when present.
// =====================================================================

import { BaseEdge, EdgeLabelRenderer, EdgeProps, useInternalNode } from "@xyflow/react";
import { useStore } from "../store";
import type { BusbarParams, CtParams, RelayParams } from "../types";
import { CtGlyph } from "./symbols";

const DEFAULT_NON_BUS_WIDTH = 80;
const DEFAULT_BUSBAR_HEIGHT = 72;

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
  let sy = sourceY;
  let ty = targetY;

  const busbarConductorY = (busCompId: string, fallbackHandleY: number): number => {
    const bus = components.find((c) => c.id === busCompId);
    if (!bus || bus.type !== "busbar") return fallbackHandleY;
    // The visible busbar conductor is the cyan strip near the top of the
    // busbar card: 6px top padding + 6px strip height / 2.
    // Snap wires to that conductor instead of to the card edge/handle dot so
    // connections visually land on the bus itself.
    return bus.position.y + 9;
  };

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

  const busbarOutsideLabelPosition = (busCompId: string, otherY: number, x: number) => {
    const bus = components.find((c) => c.id === busCompId);
    if (!bus || bus.type !== "busbar") return null;
    const node = busCompId === source ? srcNode : tgtNode;
    const height = node?.measured?.height ?? DEFAULT_BUSBAR_HEIGHT;
    const belowBus = otherY >= bus.position.y + height / 2;
    return {
      x,
      y: belowBus ? bus.position.y + height + 10 : bus.position.y - 10,
    };
  };

  // Y for a CT badge on a wire that lands on a busbar. The wire snaps to the
  // conductor strip near the top of the bus card, so the raw edge midpoint can
  // sit on top of the card when the other device is close. Slide the badge
  // along the drop line until it clears the card (and stays off the device).
  const busEdgeBadgeY = (busCompId: string, busY: number, compY: number): number => {
    const bus = components.find((c) => c.id === busCompId);
    if (!bus || bus.type !== "busbar") return (busY + compY) / 2;
    const node = busCompId === source ? srcNode : tgtNode;
    const height = node?.measured?.height ?? DEFAULT_BUSBAR_HEIGHT;
    const below = compY >= busY;
    const cardEdge = below ? bus.position.y + height : bus.position.y;
    const GAP_FROM_CARD = 16; // keep the CT clear of the busbar card
    const GAP_FROM_DEVICE = 22; // and clear of the device at the other end
    let y = (busY + compY) / 2;
    if (below) {
      y = Math.min(Math.max(y, cardEdge + GAP_FROM_CARD), compY - GAP_FROM_DEVICE);
    } else {
      y = Math.max(Math.min(y, cardEdge - GAP_FROM_CARD), compY + GAP_FROM_DEVICE);
    }
    return y;
  };

  if (srcComp?.type === "busbar" && tgtComp?.type !== "busbar") {
    sx = clampToBusbar(source, centerX(target, targetX));
    sy = busbarConductorY(source, sourceY);
  } else if (tgtComp?.type === "busbar" && srcComp?.type !== "busbar") {
    tx = clampToBusbar(target, centerX(source, sourceX));
    ty = busbarConductorY(target, targetY);
  }

  const path =
    Math.abs(sx - tx) < 0.5
      ? `M ${sx} ${sy} L ${tx} ${ty}`
      : `M ${sx} ${sy} L ${sx} ${(sy + ty) / 2} L ${tx} ${(sy + ty) / 2} L ${tx} ${ty}`;

  const midX = (sx + tx) / 2;
  const midY = (sy + ty) / 2;
  // CT badge: clear of the busbar card for wires into a bus; otherwise the
  // midpoint (nudged off a flow readout when one is shown on the same wire).
  let badgeY = midY - (ed?.label ? 15 : 0);
  if (srcComp?.type === "busbar" && tgtComp?.type !== "busbar") {
    badgeY = busEdgeBadgeY(source, sy, ty);
  } else if (tgtComp?.type === "busbar" && srcComp?.type !== "busbar") {
    badgeY = busEdgeBadgeY(target, ty, sy);
  }
  const edgeLabelPosition =
    srcComp?.type === "busbar" && tgtComp?.type !== "busbar"
      ? busbarOutsideLabelPosition(source, ty, sx)
      : tgtComp?.type === "busbar" && srcComp?.type !== "busbar"
        ? busbarOutsideLabelPosition(target, sy, tx)
        : null;
  const labelX = edgeLabelPosition?.x ?? midX;
  const labelY = edgeLabelPosition?.y ?? midY;
  const toneClass = ed?.tone ? `tone-${ed.tone}` : "";

  // Relays that measure this wire's CT get a faint dotted line from the relay
  // to the CT badge, so the link picked in the relay's dropdown is visible.
  const measuringRelays = ed?.ct
    ? components.filter(
        (c) => c.type === "relay" && (c.parameters as RelayParams).measured_connection_id === id,
      )
    : [];

  return (
    <>
      {measuringRelays.map((r) => (
        <line
          key={`ctlink-${r.id}`}
          x1={midX}
          y1={badgeY}
          x2={r.position.x + 40}
          y2={r.position.y + 40}
          stroke="var(--accent)"
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.4}
          style={{ pointerEvents: "none" }}
        />
      ))}
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
              transform: `translate(-50%, -50%) translate(${midX}px, ${badgeY}px)`,
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
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
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
