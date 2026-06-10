// =====================================================================
// Validation: pre-solve checks against the project state.
// Errors block a run; warnings inform but allow it.
// =====================================================================

import type { ProjectFile, ValidationIssue, SwitchParams, TransformerParams, ComponentType, CtParams } from "./types";
import { TERMINAL_COUNT, IS_BRANCH } from "./defaults";

// Switches, fuses, and cables can sit directly between two non-bus components
// — the network builder synthesises a bus node automatically when needed.
// Transformers still need a true bus on each side (different voltage levels).
const FLEXIBLE_NEIGHBOUR_ALLOWED: ReadonlySet<ComponentType> = new Set([
  "busbar", "load", "motor", "switch", "fuse", "cable", "grid_source",
]);

function isValidBranchNeighbour(branchType: ComponentType, otherType: ComponentType): boolean {
  if (branchType === "switch" || branchType === "fuse" || branchType === "cable") {
    return FLEXIBLE_NEIGHBOUR_ALLOWED.has(otherType);
  }
  return otherType === "busbar";
}

export function validateProject(project: ProjectFile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const compById = new Map(project.components.map((c) => [c.id, c]));

  // 1. Required-parameter check (any numeric param is NaN, undefined, or non-positive where it shouldn't be)
  for (const comp of project.components) {
    for (const [key, val] of Object.entries(comp.parameters as unknown as Record<string, unknown>)) {
      if (typeof val === "number" && (!isFinite(val) || isNaN(val))) {
        issues.push({
          level: "error",
          message: `${comp.label}: parameter "${key}" is missing or invalid.`,
          componentId: comp.id,
        });
      }
    }
  }

  // 2. Terminal connectivity — every component's required terminals must have ≥1 connection.
  //    Special case: busbars accept many connections at their single logical terminal.
  const connectionCountByComp = new Map<string, number>();
  for (const conn of project.connections) {
    connectionCountByComp.set(
      conn.fromComponent,
      (connectionCountByComp.get(conn.fromComponent) ?? 0) + 1,
    );
    connectionCountByComp.set(
      conn.toComponent,
      (connectionCountByComp.get(conn.toComponent) ?? 0) + 1,
    );
  }
  for (const comp of project.components) {
    const needed = TERMINAL_COUNT[comp.type];
    const have = connectionCountByComp.get(comp.id) ?? 0;
    if (comp.type === "busbar") {
      if (have === 0) {
        issues.push({
          level: "error",
          message: `${comp.label}: busbar has no connections.`,
          componentId: comp.id,
        });
      }
    } else {
      if (have < needed) {
        issues.push({
          level: "error",
          message: `${comp.label}: ${have} of ${needed} terminals connected.`,
          componentId: comp.id,
        });
      }
    }
  }

  // 3. Branch elements must connect to allowed neighbours.
  //    Transformers / cables: bus-to-bus only.
  //    Switches: may also chain to terminals (load, motor, grid source) or other switches.
  for (const conn of project.connections) {
    const a = compById.get(conn.fromComponent);
    const b = compById.get(conn.toComponent);
    if (!a || !b) continue;
    // Relay/CT control wires are not part of the power circuit — skip the
    // power-neighbour rules for them.
    if (a.type === "relay" || a.type === "ct" || b.type === "relay" || b.type === "ct") continue;
    if (IS_BRANCH[a.type] && !isValidBranchNeighbour(a.type, b.type)) {
      issues.push({
        level: "error",
        message: `${a.label} cannot connect to a ${b.type} on this side.`,
        componentId: a.id,
      });
    }
    if (IS_BRANCH[b.type] && !isValidBranchNeighbour(b.type, a.type)) {
      issues.push({
        level: "error",
        message: `${b.label} cannot connect to a ${a.type} on this side.`,
        componentId: b.id,
      });
    }
  }

  // 4. At least one grid source.
  const sources = project.components.filter((c) => c.type === "grid_source");
  if (sources.length === 0) {
    issues.push({
      level: "error",
      message: "No grid source in the network — needed for load flow.",
    });
  } else if (sources.length > 1) {
    issues.push({
      level: "warning",
      message: `Multiple grid sources: the first will be the slack bus; others act as PV buses (fixed voltage, scheduled P injection).`,
    });
  }

  // 5. Transformer secondary voltage matches connected bus voltage (soft warning).
  // We need to know which bus is which side. We treat the first connection as primary and second as secondary
  // by convention — the user can be careful, this is just informational.
  for (const comp of project.components) {
    if (comp.type !== "transformer") continue;
    const p = comp.parameters as TransformerParams;
    const conns = project.connections.filter(
      (c) => c.fromComponent === comp.id || c.toComponent === comp.id,
    );
    if (conns.length < 2) continue;
    const otherIds = conns.map((c) => (c.fromComponent === comp.id ? c.toComponent : c.fromComponent));
    const busVoltages = otherIds
      .map((id) => compById.get(id))
      .filter((c) => c && c.type === "busbar")
      .map((c) => (c!.parameters as { nominal_voltage_kv: number }).nominal_voltage_kv);
    if (busVoltages.length === 2) {
      const sorted = [...busVoltages].sort((a, b) => b - a);
      const tx = [p.primary_kv, p.secondary_kv].sort((a, b) => b - a);
      if (Math.abs(sorted[0] - tx[0]) > 0.1 || Math.abs(sorted[1] - tx[1]) > 0.1) {
        issues.push({
          level: "warning",
          message: `${comp.label}: voltage ratio (${p.primary_kv}/${p.secondary_kv} kV) doesn't match connected buses (${sorted[0]}/${sorted[1]} kV).`,
          componentId: comp.id,
        });
      }
    }
  }

  // 6. Protection links (warnings only — never block a power run).
  //    A relay needs a CT to measure current and a breaker to trip; a CT needs
  //    a relay to feed. Links are ordinary connections to the relay/CT.
  const neighbourTypes = (compId: string): ComponentType[] => {
    const types: ComponentType[] = [];
    for (const conn of project.connections) {
      let otherId: string | null = null;
      if (conn.fromComponent === compId) otherId = conn.toComponent;
      else if (conn.toComponent === compId) otherId = conn.fromComponent;
      if (otherId) {
        const other = compById.get(otherId);
        if (other) types.push(other.type);
      }
    }
    return types;
  };

  for (const comp of project.components) {
    if (comp.type === "relay") {
      const nbrs = neighbourTypes(comp.id);
      if (!nbrs.includes("ct")) {
        issues.push({ level: "warning", message: `${comp.label}: no CT connected — relay has no current measurement.`, componentId: comp.id });
      }
      if (!nbrs.includes("switch")) {
        issues.push({ level: "warning", message: `${comp.label}: not attached to a breaker — relay cannot trip anything.`, componentId: comp.id });
      }
    } else if (comp.type === "ct") {
      const nbrs = neighbourTypes(comp.id);
      if (!nbrs.includes("relay")) {
        issues.push({ level: "warning", message: `${comp.label}: not connected to a relay.`, componentId: comp.id });
      }
      const onId = (comp.parameters as CtParams).on_connection_id;
      if (!onId || !project.connections.some((c) => c.id === onId)) {
        issues.push({ level: "warning", message: `${comp.label}: not clamped onto a conductor — drag it onto a power wire to measure current.`, componentId: comp.id });
      }
    }
  }

  return issues;
}
