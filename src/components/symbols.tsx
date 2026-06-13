// =====================================================================
// SVG symbols for each component type.
// IEC-style electrical symbols drawn at 40×40 viewport.
// =====================================================================

import type { ComponentType } from "../types";

const STROKE = "currentColor";
const SW = 1.6;

interface SymbolProps {
  size?: number;
  state?: { closed?: boolean; intact?: boolean }; // closed: switch · intact: fuse
}

export function ComponentSymbol({
  type,
  size = 36,
  state,
}: { type: ComponentType } & SymbolProps) {
  switch (type) {
    case "grid_source":
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="14" stroke={STROKE} strokeWidth={SW} />
          <path d="M14 20 L26 20 M20 14 L20 26" stroke={STROKE} strokeWidth={SW} />
          <text x="20" y="35" fontSize="6" textAnchor="middle" fill={STROKE} fontFamily="IBM Plex Mono">G</text>
        </svg>
      );
    case "busbar":
      return null; // busbars are rendered as a horizontal bar in CSS
    case "transformer":
      // Vertical two-winding transformer: overlapping primary (top) and
      // secondary (bottom) circles, with wire stubs reaching the viewBox edges
      // so the connection edges blend into the symbol.
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
          <path d="M20 0 L20 7" stroke={STROKE} strokeWidth={SW} />
          <circle cx="20" cy="14" r="7" stroke={STROKE} strokeWidth={SW} />
          <circle cx="20" cy="22" r="7" stroke={STROKE} strokeWidth={SW} />
          <path d="M20 29 L20 40" stroke={STROKE} strokeWidth={SW} />
        </svg>
      );
    case "cable":
      // Vertical wire with three short angled slashes — IEC convention for a
      // three-phase cable run. The wire spans the full viewBox so the symbol
      // visually continues the connection edges entering/leaving the node.
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
          <path d="M20 0 L20 40" stroke={STROKE} strokeWidth={SW} />
          <path d="M14 24 L26 16" stroke={STROKE} strokeWidth={SW} />
          <path d="M14 28 L26 20" stroke={STROKE} strokeWidth={SW} />
          <path d="M14 32 L26 24" stroke={STROKE} strokeWidth={SW} />
        </svg>
      );
    case "load": {
      // Down-arrow inside circle (consumption)
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
          <path d="M20 6 L20 20" stroke={STROKE} strokeWidth={SW} />
          <path d="M20 20 L12 32 L28 32 Z" stroke={STROKE} strokeWidth={SW} fill="none" />
        </svg>
      );
    }
    case "motor":
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="22" r="12" stroke={STROKE} strokeWidth={SW} />
          <text x="20" y="26" fontSize="11" textAnchor="middle" fill={STROKE} fontFamily="IBM Plex Mono" fontWeight="600">M</text>
          <path d="M20 4 L20 10" stroke={STROKE} strokeWidth={SW} />
        </svg>
      );
    case "switch": {
      // Vertical knife switch: wire stubs reach the viewBox edges so the
      // symbol blends into the connection edges. Hinge at bottom, contact
      // at top — open knife swings to the right.
      const closed = state?.closed ?? true;
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
          <path d="M20 0 L20 12" stroke={STROKE} strokeWidth={SW} />
          <circle cx="20" cy="12" r="2" fill={STROKE} />
          {closed ? (
            <path d="M20 12 L20 28" stroke={STROKE} strokeWidth={SW} />
          ) : (
            <path d="M20 12 L32 22" stroke={STROKE} strokeWidth={SW} />
          )}
          <circle cx="20" cy="28" r="2" fill={STROKE} />
          <path d="M20 28 L20 40" stroke={STROKE} strokeWidth={SW} />
        </svg>
      );
    }
    case "fuse": {
      // IEC 60617 fuse symbol: rectangle on the wire. Blown state strikes
      // a diagonal through the body.
      const intact = state?.intact ?? true;
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
          <path d="M20 0 L20 12" stroke={STROKE} strokeWidth={SW} />
          <rect x="13" y="12" width="14" height="16" stroke={STROKE} strokeWidth={SW} fill="none" />
          <path d="M20 12 L20 28" stroke={STROKE} strokeWidth={SW} />
          <path d="M20 28 L20 40" stroke={STROKE} strokeWidth={SW} />
          {!intact && (
            <path d="M11 30 L29 10" stroke={STROKE} strokeWidth={SW * 1.1} />
          )}
        </svg>
      );
    }
    case "relay":
      // IEC overcurrent relay: a circle bearing "I>" with a short control stub
      // to the trip terminal at the bottom.
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
          <path d="M20 2 L20 7" stroke={STROKE} strokeWidth={SW} />
          <circle cx="20" cy="18" r="11" stroke={STROKE} strokeWidth={SW} />
          <text x="20" y="22" fontSize="10" textAnchor="middle" fill={STROKE} fontFamily="IBM Plex Mono" fontWeight="600">I&gt;</text>
          <path d="M20 29 L20 38" stroke={STROKE} strokeWidth={SW} strokeDasharray="2 2" />
        </svg>
      );
    default:
      return null;
  }
}

// Current-transformer toroid drawn at the midpoint of a wire that carries a CT.
// Standalone (not keyed by ComponentType) because a CT is a property of a wire,
// not a placeable component.
export function CtGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke={STROKE} strokeWidth={1.6} />
      <circle cx="12" cy="12" r="3.4" stroke={STROKE} strokeWidth={1.6} />
    </svg>
  );
}
