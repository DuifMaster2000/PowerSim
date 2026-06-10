// =====================================================================
// Canvas: React Flow wrapper.
// Reads project state from the store, renders nodes/edges,
// handles drag-drop from palette, connection creation, and multi-select
// alignment operations.
// =====================================================================

import { useMemo, useCallback, useRef, useState, useEffect } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  ConnectionMode,
  MarkerType,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection as RFConnection,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStore, isControlConnection } from "../store";
import type { ComponentType, BusbarParams, BusResult, BranchResult, LoadResult, SwitchParams, FuseParams, TransformerParams, ShortCircuitBranchFlow, PowerComponent, Connection, CtParams } from "../types";
import { GenericNode, SyntheticBusNode, formatBusReadout, formatBranchReadout } from "./nodes";
import { BusbarEdge } from "./busbarEdge";

const nodeTypes = { generic: GenericNode, syntheticBus: SyntheticBusNode };
const edgeTypes = { busbar: BusbarEdge };

// Anchor point (visual centre) of a component in flow coords. Mirrors the
// half-size convention used for synthetic-bus centroids so a CT clamped to a
// wire lands on the same midpoint a synthetic-bus dot would.
function componentAnchor(c: PowerComponent): { x: number; y: number } {
  if (c.type === "busbar") {
    return { x: c.position.x + ((c.parameters as BusbarParams).length_px ?? 200) / 2, y: c.position.y + 14 };
  }
  return { x: c.position.x + 40, y: c.position.y + 40 };
}

// Midpoint of a connection (between the two components' anchors).
function connectionMidpoint(
  conn: Connection,
  byId: Map<string, PowerComponent>,
): { x: number; y: number } | null {
  const a = byId.get(conn.fromComponent);
  const b = byId.get(conn.toComponent);
  if (!a || !b) return null;
  const pa = componentAnchor(a);
  const pb = componentAnchor(b);
  return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
}

// Perpendicular distance from point p to the segment a–b.
function distToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function CanvasInner() {
  const components = useStore((s) => s.components);
  const connections = useStore((s) => s.connections);
  const faultBusId = useStore((s) => s.faultBusId);
  const loadFlow = useStore((s) => s.loadFlow);
  const animationIter = useStore((s) => s.animationIter);
  const explainMode = useStore((s) => s.explainMode);
  const baseMva = useStore((s) => s.baseMva);
  const shortCircuit = useStore((s) => s.shortCircuit);
  const runMode = useStore((s) => s.runMode);
  const selectedComponentId = useStore((s) => s.selectedComponentId);
  const edgeReadoutMode = useStore((s) => s.edgeReadoutMode);
  const viewport = useStore((s) => s.viewport);
  const setViewport = useStore((s) => s.setViewport);
  const projectLoadKey = useStore((s) => s.projectLoadKey);

  const addComponent = useStore((s) => s.addComponent);
  const updateComponentParams = useStore((s) => s.updateComponentParams);
  const updateComponentPosition = useStore((s) => s.updateComponentPosition);
  const batchUpdatePositions = useStore((s) => s.batchUpdatePositions);
  const selectComponent = useStore((s) => s.selectComponent);
  const selectConnection = useStore((s) => s.selectConnection);
  const removeComponent = useStore((s) => s.removeComponent);
  const removeConnection = useStore((s) => s.removeConnection);
  const addConnection = useStore((s) => s.addConnection);
  const setFaultBus = useStore((s) => s.setFaultBus);
  const setStartingMotorStore = useStore((s) => s.setStartingMotor);
  const duplicateComponent = useStore((s) => s.duplicateComponent);

  // Local multi-select state — driven by onSelectionChange (no loop risk)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Right-click context menu — anchored at the cursor for the clicked node.
  const [contextMenu, setContextMenu] = useState<
    { x: number; y: number; nodeId: string } | null
  >(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getNodes, fitView, setViewport: rfSetViewport } = useReactFlow();

  // Re-frame the diagram whenever a new/loaded project arrives. A file that
  // came with a saved viewport restores exactly; otherwise we fit-to-view.
  useEffect(() => {
    // Wait a tick for the new nodes to render so fitView has bounds to work with.
    const id = requestAnimationFrame(() => {
      if (viewport) {
        rfSetViewport(viewport);
      } else {
        fitView({ padding: 0.2, duration: 200 });
      }
    });
    return () => cancelAnimationFrame(id);
    // viewport intentionally excluded — we only re-frame on project-level load,
    // not on every pan/zoom (which would create a feedback loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectLoadKey, fitView, rfSetViewport]);

  const getSyntheticBuses = useStore((s) => s.getSyntheticBuses);

  // Pre-index results for fast lookups. When history is present (Explain mode
  // was on for this run), override each bus voltage with the current iteration
  // snapshot so the canvas animates as the user scrubs the AnimationPlayer.
  // loadFlow.buses[i] is in the same bus-index order as history.V, so we can
  // splice the snapshot V/theta straight in.
  const busResultById = useMemo(() => {
    const m = new Map<string, BusResult>();
    if (!loadFlow?.converged) return m;
    const snap = loadFlow.history?.[Math.min(animationIter, loadFlow.history.length - 1)];
    loadFlow.buses.forEach((r, i) => {
      if (snap) {
        const baseKv = r.voltagePu > 0 ? r.voltageKv / r.voltagePu : r.nominalKv;
        const Vpu = snap.V[i];
        m.set(r.busId, {
          ...r,
          voltagePu: Vpu,
          voltageKv: Vpu * baseKv,
          angleDeg: (snap.theta[i] * 180) / Math.PI,
        });
      } else {
        m.set(r.busId, r);
      }
    });
    return m;
  }, [loadFlow, animationIter]);
  const branchResultById = useMemo(() => {
    const m = new Map<string, BranchResult>();
    if (loadFlow?.converged) for (const r of loadFlow.branches) m.set(r.branchId, r);
    return m;
  }, [loadFlow]);
  const loadResultById = useMemo(() => {
    const m = new Map<string, LoadResult>();
    if (loadFlow?.converged) for (const r of loadFlow.loads) m.set(r.loadId, r);
    return m;
  }, [loadFlow]);

  // Short-circuit visualisation maps. Active only when the user has just run a
  // short-circuit study; otherwise both are empty and the canvas falls back to
  // the load-flow / idle rendering paths below.
  const isShortCircuit = runMode === "shortcircuit" && !!shortCircuit;
  const contributionKaById = useMemo(() => {
    const m = new Map<string, number>();
    if (isShortCircuit && shortCircuit) {
      for (const c of shortCircuit.contributions) m.set(c.sourceId, c.currentKa);
    }
    return m;
  }, [isShortCircuit, shortCircuit]);
  const branchFlowById = useMemo(() => {
    const m = new Map<string, ShortCircuitBranchFlow>();
    if (isShortCircuit && shortCircuit) {
      for (const bf of shortCircuit.branchFlows) m.set(bf.branchId, bf);
    }
    return m;
  }, [isShortCircuit, shortCircuit]);

  // Synthetic-bus dots. Each one sits at the centroid of the wires that make
  // up its electrical bus (the connections between its member components).
  // Recomputed when topology, results or fault selection change.
  const syntheticBusNodes = useMemo<Node[]>(() => {
    if (components.length === 0) return [];
    const synthBuses = getSyntheticBuses();
    if (synthBuses.length === 0) return [];

    const posByComp = new Map(components.map((c) => [c.id, c.position]));
    const halfSize = (id: string): { hx: number; hy: number } => {
      const c = components.find((cc) => cc.id === id);
      if (c?.type === "busbar") {
        return { hx: ((c.parameters as BusbarParams).length_px ?? 200) / 2, hy: 14 };
      }
      return { hx: 40, hy: 40 };
    };

    return synthBuses.map((sb) => {
      const memberSet = new Set(sb.memberComponentIds);
      const wiresInClass = connections.filter(
        (c) => memberSet.has(c.fromComponent) && memberSet.has(c.toComponent),
      );

      let sumX = 0, sumY = 0, count = 0;
      for (const w of wiresInClass) {
        const a = posByComp.get(w.fromComponent);
        const b = posByComp.get(w.toComponent);
        if (!a || !b) continue;
        const ha = halfSize(w.fromComponent);
        const hb = halfSize(w.toComponent);
        sumX += ((a.x + ha.hx) + (b.x + hb.hx)) / 2;
        sumY += ((a.y + ha.hy) + (b.y + hb.hy)) / 2;
        count++;
      }
      if (count === 0) {
        for (const id of sb.memberComponentIds) {
          const p = posByComp.get(id);
          if (!p) continue;
          const h = halfSize(id);
          sumX += p.x + h.hx;
          sumY += p.y + h.hy;
          count++;
        }
      }
      const cx = count > 0 ? sumX / count : 0;
      const cy = count > 0 ? sumY / count : 0;

      let readoutText: string | undefined;
      let readoutTone: "ok" | "warn" | "bad" | undefined;
      if (isShortCircuit && shortCircuit && sb.id === shortCircuit.faultBusId) {
        readoutText = `Ik" ${shortCircuit.ikSymKa.toFixed(2)} kA · ip ${shortCircuit.ipPeakKa.toFixed(2)} kA`;
        readoutTone = "bad";
      } else {
        const busRes = busResultById.get(sb.id);
        const r = busRes ? formatBusReadout(busRes) : undefined;
        readoutText = r?.text;
        readoutTone = r?.tone;
      }

      return {
        id: sb.id,
        type: "syntheticBus",
        position: { x: cx - 6, y: cy - 6 },
        draggable: false,
        selectable: true,
        data: {
          label: sb.label,
          isFault: sb.id === faultBusId && runMode === "shortcircuit",
          readout: readoutText,
          tone: readoutTone,
        },
      } as Node;
    });
  }, [components, connections, getSyntheticBuses, busResultById, faultBusId, runMode, isShortCircuit, shortCircuit]);

  // Build React Flow nodes. isSelected is driven from the store (same source
  // as the edge touching-selected highlight) so both always stay in sync.
  const componentNodes: Node[] = useMemo(
    () => {
      const compById = new Map(components.map((c) => [c.id, c]));
      return components.map((c) => {
        let readout: { text: string; tone: "ok" | "warn" | "bad" } | undefined;
        if (isShortCircuit && shortCircuit) {
          if (c.type === "busbar" && c.id === shortCircuit.faultBusId) {
            readout = {
              text: `Ik" ${shortCircuit.ikSymKa.toFixed(2)} kA · ip ${shortCircuit.ipPeakKa.toFixed(2)} kA`,
              tone: "bad",
            };
          } else if (contributionKaById.has(c.id)) {
            readout = {
              text: `${contributionKaById.get(c.id)!.toFixed(2)} kA →`,
              tone: "bad",
            };
          }
        } else {
          readout =
            c.type === "busbar"
              ? formatBusReadout(busResultById.get(c.id))
              : formatBranchReadout(branchResultById.get(c.id));
        }

        const isBusbar = c.type === "busbar";

        // A CT clamped to a conductor renders at that wire's midpoint and is
        // locked in place (it follows the conductor, not free dragging).
        let nodePosition = c.position;
        let nodeDraggable: boolean | undefined = undefined;
        if (c.type === "ct") {
          const onId = (c.parameters as CtParams).on_connection_id;
          const conn = onId ? connections.find((cc) => cc.id === onId) : undefined;
          const mid = conn ? connectionMidpoint(conn, compById) : null;
          if (mid) {
            // Centre the 40px-wide chrome-less CT wrapper on the wire midpoint.
            nodePosition = { x: mid.x - 20, y: mid.y - 20 };
            nodeDraggable = false;
          }
        }

        // Explain-mode educational overlays — one short line under the label.
        let baseOverlay: string | undefined;
        if (explainMode) {
          if (isBusbar) {
            const kv = (c.parameters as BusbarParams).nominal_voltage_kv;
            if (kv > 0 && baseMva > 0) {
              const zBase = (kv * kv) / baseMva;
              baseOverlay = `Z_base = ${kv}² / ${baseMva} = ${zBase.toFixed(zBase < 1 ? 4 : 2)} Ω`;
            }
          } else if (c.type === "transformer") {
            const p = c.parameters as TransformerParams;
            if (p.rated_mva > 0) {
              const zPu = (p.impedance_percent / 100) * (baseMva / p.rated_mva);
              baseOverlay = `Z_pu = ${p.impedance_percent}% × ${baseMva}/${p.rated_mva} = ${zPu.toFixed(4)}`;
            }
          }
        }

        return {
          id: c.id,
          type: "generic",
          position: nodePosition,
          draggable: nodeDraggable,
          // Setting style.width on the node lets React Flow size the wrapper
          // correctly so handles and the NodeResizer line up with the visible bar.
          style: isBusbar
            ? { width: (c.parameters as BusbarParams).length_px ?? 200 }
            : undefined,
          data: {
            componentType: c.type,
            label: c.label,
            readout: readout?.text,
            readoutTone: readout?.tone,
            isFault: c.id === faultBusId && c.type === "busbar" && runMode === "shortcircuit",
            switchClosed: c.type === "switch" ? (c.parameters as SwitchParams).closed : undefined,
            fuseIntact: c.type === "fuse" ? (c.parameters as FuseParams).intact : undefined,
            busLengthPx: isBusbar ? (c.parameters as BusbarParams).length_px ?? 200 : undefined,
            isSelected: c.id === selectedComponentId,
            ratioText: c.type === "transformer"
              ? `${(c.parameters as TransformerParams).primary_kv} kV / ${(c.parameters as TransformerParams).secondary_kv} kV`
              : undefined,
            baseOverlay,
          },
        };
      });
    },
    [components, connections, busResultById, branchResultById, faultBusId, runMode, selectedComponentId, isShortCircuit, shortCircuit, contributionKaById, explainMode, baseMva],
  );

  const nodes: Node[] = useMemo(
    () => [...componentNodes, ...syntheticBusNodes],
    [componentNodes, syntheticBusNodes],
  );

  const edges: Edge[] = useMemo(
    () =>
      connections.map((c) => {
        const touchesSelected =
          selectedComponentId !== null &&
          (c.fromComponent === selectedComponentId || c.toComponent === selectedComponentId);
        const fromComp = components.find((cc) => cc.id === c.fromComponent);
        const toComp = components.find((cc) => cc.id === c.toComponent);
        const involvesBusbar = fromComp?.type === "busbar" || toComp?.type === "busbar";

        // Control wires (relay/CT signalling) are not part of the power circuit:
        // render them dashed and muted, with no flow label or arrowhead.
        const isControl =
          fromComp?.type === "relay" || fromComp?.type === "ct" ||
          toComp?.type === "relay" || toComp?.type === "ct";
        if (isControl) {
          return {
            id: c.id,
            source: c.fromComponent,
            sourceHandle: c.fromTerminal,
            target: c.toComponent,
            targetHandle: c.toTerminal,
            className: touchesSelected ? "touching-selected control-edge" : "control-edge",
            style: { stroke: "#7c8aa5", strokeWidth: 1.4, strokeDasharray: "5 4" },
          } as Edge;
        }

        // Compute per-edge flow info (current, label, direction, tone)
        let label: string | undefined;
        let tone: "ok" | "warn" | "bad" | "live" = "ok";
        let arrowAt: "source" | "target" | null = null;
        let currentA = 0;

        if (isShortCircuit && fromComp && toComp) {
          // 1) Wires leaving a contributing source/motor: label with the
          //    contribution kA, arrow away from the contributor.
          let contribEnd: "source" | "target" | null = null;
          let contribId: string | null = null;
          if (contributionKaById.has(fromComp.id)) {
            contribEnd = "source"; contribId = fromComp.id;
          } else if (contributionKaById.has(toComp.id)) {
            contribEnd = "target"; contribId = toComp.id;
          }
          if (contribId && contribEnd) {
            const ka = contributionKaById.get(contribId)!;
            tone = "bad";
            label = `${ka.toFixed(2)} kA`;
            arrowAt = contribEnd === "source" ? "target" : "source";
          } else {
            // 2) Wires touching a transformer/cable along the fault path: label
            //    with the kA on that side of the branch (so a transformer's
            //    primary and secondary stubs read at their own voltage bases).
            let branchEnd: "source" | "target" | null = null;
            let branchId: string | null = null;
            let branchTerminal: string | null = null;
            if (fromComp.type === "transformer" || fromComp.type === "cable") {
              branchEnd = "source"; branchId = fromComp.id; branchTerminal = c.fromTerminal;
            } else if (toComp.type === "transformer" || toComp.type === "cable") {
              branchEnd = "target"; branchId = toComp.id; branchTerminal = c.toTerminal;
            }
            if (branchId && branchEnd && branchTerminal) {
              const bf = branchFlowById.get(branchId);
              if (bf) {
                const side: "from" | "to" | null =
                  branchTerminal === "primary" || branchTerminal === "from" ? "from"
                  : branchTerminal === "secondary" || branchTerminal === "to" ? "to"
                  : null;
                if (side) {
                  const ka = side === "from" ? bf.fromSideKa : bf.toSideKa;
                  if (ka > 0) {
                    tone = "bad";
                    label = `${ka.toFixed(2)} kA`;
                    // Flow goes from the non-fault side of the branch toward
                    // the fault side. Arrow placed at whichever end of THIS
                    // wire sits on the path toward the fault bus.
                    const wireOnFaultSide = side === "from" ? bf.faultOnFromSide : !bf.faultOnFromSide;
                    const busEnd: "source" | "target" = branchEnd === "source" ? "target" : "source";
                    arrowAt = wireOnFaultSide ? busEnd : branchEnd;
                  }
                }
              }
            }
          }
        } else if (loadFlow?.converged && fromComp && toComp) {
          // Load/motor edge: arrow always points to the consumer
          const loadEnd =
            loadResultById.has(fromComp.id) ? "source" :
            loadResultById.has(toComp.id) ? "target" : null;
          if (loadEnd) {
            const ld = loadResultById.get(loadEnd === "source" ? fromComp.id : toComp.id)!;
            currentA = ld.currentA;
            arrowAt = loadEnd;
            tone = "live";
            label = edgeReadoutMode === "detailed"
              ? `${currentA.toFixed(0)} A · ${ld.pKw.toFixed(0)} kW`
              : `${currentA.toFixed(0)} A`;
          } else {
            // Branch edge: lookup branch result on either endpoint
            const branchCompId = branchResultById.has(fromComp.id) ? fromComp.id
              : branchResultById.has(toComp.id) ? toComp.id : null;
            if (branchCompId) {
              const br = branchResultById.get(branchCompId)!;

              // Determine which bus this particular edge touches (needed for
              // both current scaling and arrow direction).
              const branchEnd = branchCompId === fromComp.id ? "source" : "target";
              const busEnd: "source" | "target" = branchEnd === "source" ? "target" : "source";
              const busId = branchEnd === "source" ? toComp.id : fromComp.id;

              // br.currentA is the from-bus (primary) side current. For edges on
              // the to-bus (secondary) side — e.g. the LV side of a transformer —
              // scale by the base-voltage ratio so the label shows the correct amps.
              // For cables/switches the ratio is 1 and this is a no-op.
              currentA = br.currentA;
              if (busId === br.toBus) {
                const fromBusRes = busResultById.get(br.fromBus);
                const toBusRes = busResultById.get(br.toBus);
                if (fromBusRes && toBusRes && toBusRes.voltagePu > 0) {
                  const fromBaseKv = fromBusRes.voltageKv / fromBusRes.voltagePu;
                  const toBaseKv = toBusRes.voltageKv / toBusRes.voltagePu;
                  if (toBaseKv > 0) currentA = br.currentA * (fromBaseKv / toBaseKv);
                }
              }

              const lp = br.loadingPercent;
              tone = lp > 100 ? "bad" : lp > 80 ? "warn" : "live";
              label = edgeReadoutMode === "detailed"
                ? (lp > 0
                    ? `${currentA.toFixed(0)} A · ${(br.pMw * 1000).toFixed(0)} kW · ${lp.toFixed(0)}%`
                    : `${currentA.toFixed(0)} A · ${(br.pMw * 1000).toFixed(0)} kW`)
                : (lp > 0 ? `${currentA.toFixed(0)} A · ${lp.toFixed(0)}%` : `${currentA.toFixed(0)} A`);

              // Direction: flow goes br.fromBus → br.toBus when pMw > 0.
              const forward = br.pMw >= 0;
              if (busId === br.fromBus) arrowAt = forward ? branchEnd : busEnd;
              else if (busId === br.toBus) arrowAt = forward ? busEnd : branchEnd;
            }
          }
        }

        const toneColor =
          tone === "bad" ? "#f87171" :
          tone === "warn" ? "#fbbf24" :
          tone === "live" ? "#22d3ee" :
          undefined;

        return {
          id: c.id,
          source: c.fromComponent,
          sourceHandle: c.fromTerminal,
          target: c.toComponent,
          targetHandle: c.toTerminal,
          type: involvesBusbar ? "busbar" : undefined,
          className: touchesSelected ? "touching-selected" : undefined,
          style: toneColor ? { stroke: toneColor, strokeWidth: 2 } : undefined,
          markerStart: arrowAt === "source"
            ? { type: MarkerType.ArrowClosed, color: toneColor ?? "#7f8fa6", width: 16, height: 16 }
            : undefined,
          markerEnd: arrowAt === "target"
            ? { type: MarkerType.ArrowClosed, color: toneColor ?? "#7f8fa6", width: 16, height: 16 }
            : undefined,
          data: label ? { label, tone } : undefined,
        };
      }),
    [connections, selectedComponentId, components, loadFlow, loadResultById, branchResultById, edgeReadoutMode, isShortCircuit, contributionKaById, branchFlowById],
  );

  // ----- Handlers -----

  // onNodeClick handles immediate single-click selection in the store.
  // This fires synchronously on click, before React Flow's internal reconciliation,
  // so the properties panel updates on the first click without any delay.
  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if (node.type === "syntheticBus") {
        setFaultBus(node.id);
        selectComponent(null);
        return;
      }
      selectComponent(node.id);
      const comp = components.find((c) => c.id === node.id);
      if (comp?.type === "busbar") setFaultBus(comp.id);
      if (comp?.type === "motor") setStartingMotorStore(comp.id);
    },
    [selectComponent, components, setFaultBus, setStartingMotorStore],
  );

  // onSelectionChange mirrors React Flow's multi-select into selectedIds (for the
  // align bar). We do NOT clear the store selection here: React Flow fires this
  // with empty nodes any time focus leaves the canvas (e.g. user types in the
  // PropertiesPanel), which would blank the panel mid-edit. Store selection is
  // cleared only when the user explicitly clicks empty canvas (onPaneClick).
  const onSelectionChange = useCallback(
    ({ nodes: selNodes }: OnSelectionChangeParams) => {
      setSelectedIds(selNodes.map((n) => n.id));
    },
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const ch of changes) {
        // Synthetic bus ids start with "node-" and are derived — never edited directly.
        if ("id" in ch && typeof ch.id === "string" && ch.id.startsWith("node-")) continue;
        if (ch.type === "position" && ch.position && !ch.dragging) {
          updateComponentPosition(ch.id, ch.position);
        } else if (ch.type === "remove") {
          removeComponent(ch.id);
          setSelectedIds((prev) => prev.filter((id) => id !== ch.id));
        }
      }
    },
    [updateComponentPosition, removeComponent],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const ch of changes) {
        if (ch.type === "remove") removeConnection(ch.id);
        if (ch.type === "select" && ch.selected) selectConnection(ch.id);
      }
    },
    [removeConnection, selectConnection],
  );

  const onConnect = useCallback(
    (params: RFConnection) => {
      if (!params.source || !params.target) return;
      if (params.source === params.target) return;
      addConnection(
        params.source,
        params.sourceHandle ?? "",
        params.target,
        params.targetHandle ?? "",
      );
    },
    [addConnection],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/power-sim-type") as ComponentType;
      if (!type) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

      // A CT clamps onto the nearest power conductor under the drop point.
      if (type === "ct") {
        const byId = new Map(components.map((c) => [c.id, c]));
        let nearestId: string | null = null;
        let nearestDist = Infinity;
        for (const conn of connections) {
          if (isControlConnection(conn, components)) continue; // power wires only
          const a = byId.get(conn.fromComponent);
          const b = byId.get(conn.toComponent);
          if (!a || !b) continue;
          const d = distToSegment(position, componentAnchor(a), componentAnchor(b));
          if (d < nearestDist) {
            nearestDist = d;
            nearestId = conn.id;
          }
        }
        const id = addComponent(type, position);
        // Snap threshold in flow units — generous so a drop "near" a wire takes.
        if (nearestId && nearestDist <= 70) {
          updateComponentParams<"ct">(id, { on_connection_id: nearestId });
        }
        return;
      }

      addComponent(type, position);
    },
    [addComponent, updateComponentParams, screenToFlowPosition, components, connections],
  );

  const onPaneClick = useCallback(() => {
    selectComponent(null);
    setSelectedIds([]);
    setContextMenu(null);
  }, [selectComponent]);

  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      e.preventDefault();
      const rect = wrapperRef.current?.getBoundingClientRect();
      setContextMenu({
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
        nodeId: node.id,
      });
      selectComponent(node.id);
    },
    [selectComponent],
  );

  // ----- Alignment -----

  const alignCenterX = useCallback(() => {
    const rfNodes = getNodes();
    const sel = rfNodes.filter((n) => selectedIds.includes(n.id));
    if (sel.length < 2) return;

    // Resolve each node's actual rendered width.
    // Prefer React Flow's measured value; fall back to the CSS min-widths
    // defined in styles.css (busbar = 140px, all others = 80px) so that
    // mixed-size selections (e.g. busbar + transformer) align true centers.
    const nodeWidth = (nodeId: string, measured?: number): number => {
      if (measured && measured > 0) return measured;
      const comp = components.find((c) => c.id === nodeId);
      if (comp?.type === "busbar") {
        return (comp.parameters as BusbarParams).length_px ?? 200;
      }
      return 80;
    };

    const info = sel.map((n) => {
      const w = nodeWidth(n.id, n.measured?.width);
      return { id: n.id, cx: n.position.x + w / 2, hw: w / 2, y: n.position.y };
    });

    const avgCx = info.reduce((s, c) => s + c.cx, 0) / info.length;
    const snap = 4;
    const snapX = (x: number) => Math.round(x / snap) * snap;

    batchUpdatePositions(
      info.map((c) => ({ id: c.id, position: { x: snapX(avgCx - c.hw), y: c.y } })),
    );
  }, [selectedIds, getNodes, batchUpdatePositions, components]);

  return (
    <div ref={wrapperRef} className="canvas-area">
      {selectedIds.length >= 2 && (
        <div className="align-bar">
          <span className="align-bar-count">{selectedIds.length} selected</span>
          <div className="align-bar-divider" />
          <button className="align-bar-btn" onClick={alignCenterX} title="Align centers to the same vertical axis">
            Align Center X
          </button>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onSelectionChange={onSelectionChange}
        onMoveEnd={(_e, vp) => setViewport(vp)}
        snapToGrid
        snapGrid={[4, 4]}
        proOptions={{ hideAttribution: true }}
        defaultViewport={viewport ?? { x: 0, y: 0, zoom: 1 }}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              duplicateComponent(contextMenu.nodeId);
              setContextMenu(null);
            }}
          >
            Duplicate
          </button>
          <button
            className="context-menu-item danger"
            onClick={() => {
              removeComponent(contextMenu.nodeId);
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
