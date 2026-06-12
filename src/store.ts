// =====================================================================
// Zustand store: project state, selection, results, and dispatch.
// =====================================================================

import { create } from "zustand";
import type {
  PowerComponent,
  Connection,
  ProjectFile,
  ComponentType,
  ParamsByType,
  LoadFlowResult,
  ShortCircuitResult,
  MotorStartingResult,
  ValidationIssue,
} from "./types";
import type { CtParams, RelayParams } from "./types";
import { DEFAULT_PARAMS, COMPONENT_PREFIXES } from "./defaults";
import { validateProject } from "./validation";
import { buildNetwork } from "./solver/network";

// A connection is a control wire (not part of the power circuit) iff either
// endpoint is a relay. Used by the canvas (dashed styling), the network builder,
// and validation to keep protection signalling out of the power model. CTs are
// now a property of a power wire, not a component, so they never form a wire.
export function isControlConnection(
  conn: Connection,
  components: PowerComponent[],
): boolean {
  const byId = (id: string) => components.find((c) => c.id === id);
  const a = byId(conn.fromComponent);
  const b = byId(conn.toComponent);
  return a?.type === "relay" || b?.type === "relay";
}

// A short label for the conductor a CT sits on, e.g. "BB-01 → Q-01".
export function connectionLabel(
  conn: Connection,
  components: PowerComponent[],
): string {
  const labelOf = (id: string) => components.find((c) => c.id === id)?.label ?? id;
  return `${labelOf(conn.fromComponent)} → ${labelOf(conn.toComponent)}`;
}

// Resolved protection links for a relay: the CT it measures (a property of a
// wire, referenced by RelayParams.measured_connection_id) and the breaker it
// trips (found by following its control wire). Either may be null if unset.
export interface RelayLinks {
  ctConnectionId: string | null;
  ctLabel: string | null;
  ct: CtParams | null;
  breakerId: string | null;
  breakerLabel: string | null;
}

export function resolveRelayLinks(
  relayId: string,
  components: PowerComponent[],
  connections: Connection[],
): RelayLinks {
  const byId = (id: string) => components.find((c) => c.id === id);
  const relay = byId(relayId);
  const relayParams = relay?.type === "relay" ? (relay.parameters as RelayParams) : null;

  // CT: the wire the relay is assigned to measure, if that wire still carries a CT.
  const ctConnId = relayParams?.measured_connection_id ?? null;
  const ctConn = ctConnId ? connections.find((c) => c.id === ctConnId) : undefined;
  const ct = ctConn?.ct ?? null;

  // Breaker: the first switch reached over a control wire from the relay.
  let breakerId: string | null = null;
  for (const conn of connections) {
    let otherId: string | null = null;
    if (conn.fromComponent === relayId) otherId = conn.toComponent;
    else if (conn.toComponent === relayId) otherId = conn.fromComponent;
    if (!otherId) continue;
    const other = byId(otherId);
    if (other?.type === "switch" && !breakerId) breakerId = other.id;
  }
  const breakerComp = breakerId ? byId(breakerId) : null;

  return {
    ctConnectionId: ct ? ctConnId : null,
    ctLabel: ct && ctConn ? connectionLabel(ctConn, components) : null,
    ct,
    breakerId,
    breakerLabel: breakerComp?.label ?? null,
  };
}

// Migrate legacy projects (CT as a draggable component with `on_connection_id`)
// to the wire-CT model: copy each CT's rating onto the conductor it clamped,
// repoint any relay that was control-wired to it, then drop the CT components
// and their control wires. Returns cleaned components + connections.
function migrateLegacyCts(
  components: PowerComponent[],
  connections: Connection[],
): { components: PowerComponent[]; connections: Connection[] } {
  const cts = components.filter((c) => (c.type as string) === "ct");
  if (cts.length === 0) return { components, connections };

  const ctIds = new Set(cts.map((c) => c.id));
  let conns = connections.map((c) => ({ ...c }));
  const comps = components.map((c) => ({ ...c }));

  // relay id → connection id the relay should now measure
  const relayMeasures = new Map<string, string>();

  for (const ct of cts) {
    const params = ct.parameters as unknown as { primary_a?: number; secondary_a?: 1 | 5; on_connection_id?: string | null };
    const onId = params.on_connection_id ?? null;
    if (onId) {
      const target = conns.find((c) => c.id === onId);
      if (target) {
        target.ct = { primary_a: params.primary_a ?? 200, secondary_a: params.secondary_a ?? 5 };
        // Any relay wired to this CT now measures the clamped conductor.
        for (const conn of conns) {
          const other =
            conn.fromComponent === ct.id ? conn.toComponent :
            conn.toComponent === ct.id ? conn.fromComponent : null;
          if (other && comps.find((c) => c.id === other)?.type === "relay") {
            relayMeasures.set(other, onId);
          }
        }
      }
    }
  }

  for (const c of comps) {
    if (c.type === "relay" && relayMeasures.has(c.id)) {
      c.parameters = { ...(c.parameters as RelayParams), measured_connection_id: relayMeasures.get(c.id)! };
    }
  }

  return {
    components: comps.filter((c) => !ctIds.has(c.id)),
    connections: conns.filter((c) => !ctIds.has(c.fromComponent) && !ctIds.has(c.toComponent)),
  };
}
import { runLoadFlow } from "./solver/loadFlow";
import { runShortCircuit } from "./solver/shortCircuit";
import { runMotorStarting } from "./solver/motorStart";

let idCounter = 1;
const nextId = (prefix: string) => `${prefix}-${idCounter++}`;

// Debounce state for updateComponentParams — lives outside Zustand to avoid being snapshotted.
let _paramDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let _paramDebounceCompId: string | null = null;
const nextLabel = (prefix: string, existing: PowerComponent[]) => {
  const sameType = existing.filter((c) => c.label.startsWith(prefix));
  return `${prefix}-${String(sameType.length + 1).padStart(2, "0")}`;
};

type RunMode = "idle" | "loadflow" | "shortcircuit" | "motorstart";

// View-state preferences live outside the project file and outside
// undo/redo. They're persisted to localStorage so they survive reloads.
const EXPLAIN_STORAGE_KEY = "powersim.explainMode";
const readExplainModePref = (): boolean => {
  try {
    return localStorage.getItem(EXPLAIN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};
const writeExplainModePref = (v: boolean) => {
  try {
    localStorage.setItem(EXPLAIN_STORAGE_KEY, v ? "1" : "0");
  } catch {
    // ignore (private browsing, quota, etc.)
  }
};

interface Snapshot {
  projectName: string;
  baseMva: number;
  frequencyHz: number;
  components: PowerComponent[];
  connections: Connection[];
}

const MAX_HISTORY = 50;

interface State {
  // Project
  projectName: string;
  baseMva: number;
  frequencyHz: number;
  components: PowerComponent[];
  connections: Connection[];

  // Selection
  selectedComponentId: string | null;
  selectedConnectionId: string | null;

  // Run mode and results
  runMode: RunMode;
  loadFlow: LoadFlowResult | null;
  shortCircuit: ShortCircuitResult | null;
  motorStarting: MotorStartingResult | null;
  validation: ValidationIssue[];

  // For short-circuit: which bus is the fault target
  faultBusId: string | null;

  // For motor-starting: which motor is the start target
  startingMotorId: string | null;

  // IEC 60909 voltage factor c (1.10 = max fault, 1.05 = min fault)
  shortCircuitCFactor: 1.05 | 1.10;

  // Visual: how much detail to show on edge labels after a load flow run.
  edgeReadoutMode: "minimal" | "detailed";

  // Viewport (pan + zoom); null means "frame the diagram on next mount".
  viewport: { x: number; y: number; zoom: number } | null;

  // Bumped on every newProject/loadProject so Canvas can re-fit the view.
  projectLoadKey: number;

  // Unsaved changes flag
  isDirty: boolean;

  // View preferences (persisted to localStorage, NOT to the project file
  // and NOT part of the undo/redo snapshot).
  explainMode: boolean;
  glossaryOpen: boolean;

  // Animation player cursor for the load-flow iteration history.
  // Reset to 0 on every fresh run and whenever the network mutates.
  animationIter: number;

  // Which tab the bottom results dock shows: solver results or the protection
  // grading chart. View-only; not part of the project file.
  resultsTab: "results" | "grading";

  // Undo / redo history
  past: Snapshot[];
  future: Snapshot[];

  // Actions
  addComponent: (type: ComponentType, position: { x: number; y: number }) => string;
  duplicateComponent: (id: string) => string | null;
  removeComponent: (id: string) => void;
  updateComponentParams: <T extends ComponentType>(id: string, params: Partial<ParamsByType[T]>) => void;
  updateComponentLabel: (id: string, label: string) => void;
  updateComponentPosition: (id: string, position: { x: number; y: number }) => void;

  batchUpdatePositions: (updates: { id: string; position: { x: number; y: number } }[]) => void;

  addConnection: (
    fromComponent: string,
    fromTerminal: string,
    toComponent: string,
    toTerminal: string,
  ) => void;
  removeConnection: (id: string) => void;
  setConnectionCt: (id: string, ct: CtParams | null) => void;

  selectComponent: (id: string | null) => void;
  selectConnection: (id: string | null) => void;
  toggleSwitch: (id: string) => void;

  setBaseMva: (v: number) => void;
  setFrequencyHz: (v: number) => void;
  setProjectName: (n: string) => void;
  setShortCircuitCFactor: (v: 1.05 | 1.10) => void;
  setEdgeReadoutMode: (v: "minimal" | "detailed") => void;
  setViewport: (v: { x: number; y: number; zoom: number }) => void;
  setExplainMode: (v: boolean) => void;
  setGlossaryOpen: (v: boolean) => void;
  setAnimationIter: (i: number) => void;
  setResultsTab: (v: "results" | "grading") => void;
  markSaved: () => void;

  newProject: () => void;
  loadProject: (file: ProjectFile) => void;
  exportProject: () => ProjectFile;

  undo: () => void;
  redo: () => void;

  validate: () => ValidationIssue[];
  runLoadFlow: () => void;
  setFaultBus: (busId: string | null) => void;
  runShortCircuit: () => void;
  setStartingMotor: (motorId: string | null) => void;
  runMotorStarting: () => void;
  clearResults: () => void;

  // Solver-derived view: synthetic buses (those without a real busbar component)
  // — needed by the canvas to draw selectable dots on the wires they live on.
  getSyntheticBuses: () => Array<{ id: string; label: string; memberComponentIds: string[] }>;

  // Protection: resolve each relay's CT + breaker from its control wires.
  getRelayLinks: (relayId: string) => RelayLinks;

  // Protection: per-relay fault current (primary amps) seen during the last
  // short-circuit run, mapped via the relay's breaker → adjacent branch flow.
  // Empty when no short-circuit result exists.
  getRelayFaultCurrents: () => Map<string, { primaryA: number; label: string }>;
}

const takeSnapshot = (s: State): Snapshot => ({
  projectName: s.projectName,
  baseMva: s.baseMva,
  frequencyHz: s.frequencyHz,
  components: s.components,
  connections: s.connections,
});

const withHistory = (s: State) => ({
  past: [...s.past, takeSnapshot(s)].slice(-MAX_HISTORY),
  future: [] as Snapshot[],
});

const newProjectState = () => ({
  projectName: "Untitled",
  baseMva: 100,
  frequencyHz: 50,
  components: [] as PowerComponent[],
  connections: [] as Connection[],
  selectedComponentId: null as string | null,
  selectedConnectionId: null as string | null,
  runMode: "idle" as RunMode,
  loadFlow: null,
  shortCircuit: null,
  motorStarting: null as MotorStartingResult | null,
  validation: [] as ValidationIssue[],
  faultBusId: null as string | null,
  startingMotorId: null as string | null,
  shortCircuitCFactor: 1.10 as 1.05 | 1.10,
  edgeReadoutMode: "minimal" as "minimal" | "detailed",
  viewport: null as { x: number; y: number; zoom: number } | null,
  projectLoadKey: 0,
  isDirty: false,
  past: [] as Snapshot[],
  future: [] as Snapshot[],
});

export const useStore = create<State>((set, get) => ({
  ...newProjectState(),
  explainMode: readExplainModePref(),
  glossaryOpen: false,
  animationIter: 0,
  resultsTab: "results",

  addComponent: (type, position) => {
    const prefix = COMPONENT_PREFIXES[type];
    const id = nextId(prefix);
    const label = nextLabel(prefix, get().components);
    const comp: PowerComponent = {
      id,
      type,
      label,
      position,
      parameters: { ...DEFAULT_PARAMS[type] } as PowerComponent["parameters"],
    };
    set((s) => ({
      ...withHistory(s),
      components: [...s.components, comp],
      selectedComponentId: id,
      loadFlow: null,
      shortCircuit: null,
      motorStarting: null,
      isDirty: true,
    }));
    return id;
  },

  duplicateComponent: (id) => {
    const src = get().components.find((c) => c.id === id);
    if (!src) return null;
    const prefix = COMPONENT_PREFIXES[src.type];
    const newId = nextId(prefix);
    const newLabel = nextLabel(prefix, get().components);
    const clone: PowerComponent = {
      id: newId,
      type: src.type,
      label: newLabel,
      position: { x: src.position.x + 24, y: src.position.y + 24 },
      parameters: { ...src.parameters } as PowerComponent["parameters"],
    };
    set((s) => ({
      ...withHistory(s),
      components: [...s.components, clone],
      selectedComponentId: newId,
      loadFlow: null,
      shortCircuit: null,
      motorStarting: null,
      isDirty: true,
    }));
    return newId;
  },

  removeComponent: (id) => {
    set((s) => ({
      ...withHistory(s),
      components: s.components.filter((c) => c.id !== id),
      connections: s.connections.filter((c) => c.fromComponent !== id && c.toComponent !== id),
      selectedComponentId: s.selectedComponentId === id ? null : s.selectedComponentId,
      loadFlow: null,
      shortCircuit: null,
      motorStarting: null,
      isDirty: true,
    }));
  },

  updateComponentParams: (id, params) => {
    const sameComp = _paramDebounceCompId === id;
    if (_paramDebounceTimer !== null) clearTimeout(_paramDebounceTimer);
    _paramDebounceCompId = id;
    _paramDebounceTimer = setTimeout(() => {
      _paramDebounceTimer = null;
      _paramDebounceCompId = null;
    }, 300);

    set((s) => ({
      ...(sameComp ? {} : withHistory(s)),
      components: s.components.map((c) =>
        c.id === id
          ? ({ ...c, parameters: { ...c.parameters, ...params } } as PowerComponent)
          : c,
      ),
      loadFlow: null,
      shortCircuit: null,
      motorStarting: null,
      isDirty: true,
    }));
  },

  updateComponentLabel: (id, label) => {
    set((s) => ({
      ...withHistory(s),
      components: s.components.map((c) => (c.id === id ? { ...c, label } : c)),
      isDirty: true,
    }));
  },

  updateComponentPosition: (id, position) => {
    set((s) => ({
      ...withHistory(s),
      components: s.components.map((c) => (c.id === id ? { ...c, position } : c)),
    }));
  },

  batchUpdatePositions: (updates) => {
    set((s) => ({
      ...withHistory(s),
      components: s.components.map((c) => {
        const u = updates.find((u) => u.id === c.id);
        return u ? { ...c, position: u.position } : c;
      }),
    }));
  },

  addConnection: (fromComponent, fromTerminal, toComponent, toTerminal) => {
    const existing = get().connections.find(
      (c) =>
        (c.fromComponent === fromComponent &&
          c.toComponent === toComponent &&
          c.fromTerminal === fromTerminal &&
          c.toTerminal === toTerminal) ||
        (c.fromComponent === toComponent &&
          c.toComponent === fromComponent &&
          c.fromTerminal === toTerminal &&
          c.toTerminal === fromTerminal),
    );
    if (existing) return;
    const id = `conn-${idCounter++}`;
    set((s) => ({
      ...withHistory(s),
      connections: [...s.connections, { id, fromComponent, fromTerminal, toComponent, toTerminal }],
      loadFlow: null,
      shortCircuit: null,
      motorStarting: null,
      isDirty: true,
    }));
  },

  removeConnection: (id) => {
    set((s) => ({
      ...withHistory(s),
      connections: s.connections.filter((c) => c.id !== id),
      // Detach any relay that was measuring the CT on the conductor being
      // removed, so it doesn't keep a dangling measured_connection_id.
      components: s.components.map((c) =>
        c.type === "relay" && (c.parameters as RelayParams).measured_connection_id === id
          ? { ...c, parameters: { ...c.parameters, measured_connection_id: null } }
          : c,
      ),
      selectedConnectionId: s.selectedConnectionId === id ? null : s.selectedConnectionId,
      loadFlow: null,
      shortCircuit: null,
      motorStarting: null,
      isDirty: true,
    }));
  },

  setConnectionCt: (id, ct) => {
    set((s) => ({
      ...withHistory(s),
      connections: s.connections.map((c) => (c.id === id ? { ...c, ct } : c)),
      // Removing a CT detaches any relay that was measuring it.
      components: ct
        ? s.components
        : s.components.map((c) =>
            c.type === "relay" && (c.parameters as RelayParams).measured_connection_id === id
              ? { ...c, parameters: { ...c.parameters, measured_connection_id: null } }
              : c,
          ),
      isDirty: true,
    }));
  },

  selectComponent: (id) => set({ selectedComponentId: id, selectedConnectionId: null }),
  selectConnection: (id) => set({ selectedConnectionId: id, selectedComponentId: null }),

  toggleSwitch: (id) => {
    const c = get().components.find((c) => c.id === id);
    if (!c || c.type !== "switch") return;
    const cur = (c.parameters as { closed: boolean }).closed;
    get().updateComponentParams(id, { closed: !cur });
  },

  setBaseMva: (v) => set((s) => ({ ...withHistory(s), baseMva: v, loadFlow: null, shortCircuit: null, motorStarting: null, isDirty: true })),
  setFrequencyHz: (v) => set((s) => ({ ...withHistory(s), frequencyHz: v, isDirty: true })),
  setProjectName: (n) => set({ projectName: n, isDirty: true }),
  setShortCircuitCFactor: (v) => set({ shortCircuitCFactor: v }),
  setEdgeReadoutMode: (v) => set({ edgeReadoutMode: v }),
  setViewport: (v) => set({ viewport: v }),
  setExplainMode: (v) => {
    writeExplainModePref(v);
    set({ explainMode: v });
  },
  setGlossaryOpen: (v) => set({ glossaryOpen: v }),
  setAnimationIter: (i) => set({ animationIter: i }),
  setResultsTab: (v) => set({ resultsTab: v }),
  markSaved: () => set({ isDirty: false }),

  newProject: () => set((s) => ({ ...newProjectState(), projectLoadKey: s.projectLoadKey + 1 })),

  loadProject: (file) => {
    // re-seed ID counter to avoid collisions
    const maxNum = Math.max(
      0,
      ...file.components.map((c) => {
        const m = c.id.match(/-(\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      }),
      ...file.connections.map((c) => {
        const m = c.id.match(/-(\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      }),
    );
    idCounter = maxNum + 1;
    const migrated = migrateLegacyCts(file.components, file.connections);
    set((s) => ({
      projectName: file.metadata.name,
      baseMva: file.system.base_mva,
      frequencyHz: file.system.frequency_hz,
      components: migrated.components,
      connections: migrated.connections,
      selectedComponentId: null,
      selectedConnectionId: null,
      runMode: "idle",
      loadFlow: null,
      shortCircuit: null,
      motorStarting: null,
      validation: [],
      faultBusId: null,
      startingMotorId: null,
      past: [],
      future: [],
      // Restore saved viewport if present; otherwise signal a fit-to-view.
      viewport: file.viewport ?? null,
      projectLoadKey: s.projectLoadKey + 1,
    }));
  },

  exportProject: () => {
    const s = get();
    const now = new Date().toISOString();
    return {
      version: "1.0",
      metadata: { name: s.projectName, created: now, modified: now },
      system: { base_mva: s.baseMva, frequency_hz: s.frequencyHz },
      components: s.components,
      connections: s.connections,
      viewport: s.viewport ?? undefined,
    };
  },

  undo: () => {
    const { past, future } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const current = takeSnapshot(get() as State);
    set({
      ...previous,
      past: past.slice(0, -1),
      future: [current, ...future].slice(0, MAX_HISTORY),
      selectedComponentId: null,
      selectedConnectionId: null,
      loadFlow: null,
      shortCircuit: null,
      motorStarting: null,
      runMode: "idle",
      validation: [],
    });
  },

  redo: () => {
    const { past, future } = get();
    if (future.length === 0) return;
    const next = future[0];
    const current = takeSnapshot(get() as State);
    set({
      ...next,
      past: [...past, current].slice(-MAX_HISTORY),
      future: future.slice(1),
      selectedComponentId: null,
      selectedConnectionId: null,
      loadFlow: null,
      shortCircuit: null,
      motorStarting: null,
      runMode: "idle",
      validation: [],
    });
  },

  validate: () => {
    const issues = validateProject(get().exportProject());
    set({ validation: issues });
    return issues;
  },

  runLoadFlow: () => {
    const issues = get().validate();
    if (issues.some((i) => i.level === "error")) {
      set({ runMode: "idle" });
      return;
    }
    try {
      const net = buildNetwork(get().exportProject());
      const result = runLoadFlow(net, { captureHistory: get().explainMode });
      const lastIter = (result.history?.length ?? 1) - 1;
      set({
        loadFlow: result,
        runMode: "loadflow",
        animationIter: Math.max(0, lastIter),
      });
    } catch (err) {
      set({
        loadFlow: {
          converged: false,
          iterations: 0,
          message: err instanceof Error ? err.message : "Unknown solver error",
          buses: [],
          branches: [],
          loads: [],
        },
        runMode: "loadflow",
      });
    }
  },

  setFaultBus: (busId) => set({ faultBusId: busId }),

  runShortCircuit: () => {
    const issues = get().validate();
    if (issues.some((i) => i.level === "error")) {
      set({ runMode: "idle" });
      return;
    }
    const faultId = get().faultBusId;
    if (!faultId) {
      set({
        runMode: "shortcircuit",
        shortCircuit: null,
        validation: [
          ...get().validation,
          { level: "error", message: "Select a busbar first, then click 'Run Short Circuit'." },
        ],
      });
      return;
    }
    try {
      const net = buildNetwork(get().exportProject());
      const busIdx = net.busIndexById.get(faultId);
      if (busIdx === undefined) {
        set({ runMode: "idle" });
        return;
      }
      const result = runShortCircuit(net, busIdx, get().shortCircuitCFactor);
      set({ shortCircuit: result, runMode: "shortcircuit" });
    } catch (err) {
      set({
        shortCircuit: null,
        runMode: "shortcircuit",
        validation: [
          ...get().validation,
          {
            level: "error",
            message: err instanceof Error ? err.message : "Short-circuit solver error",
          },
        ],
      });
    }
  },

  setStartingMotor: (motorId) => set({ startingMotorId: motorId }),

  runMotorStarting: () => {
    const issues = get().validate();
    if (issues.some((i) => i.level === "error")) {
      set({ runMode: "idle" });
      return;
    }
    const motorId = get().startingMotorId;
    if (!motorId) {
      set({
        runMode: "motorstart",
        motorStarting: null,
        validation: [
          ...get().validation,
          { level: "error", message: "Select a motor first, then click 'Run Motor Start'." },
        ],
      });
      return;
    }
    const motorComp = get().components.find((c) => c.id === motorId && c.type === "motor");
    if (!motorComp) {
      set({
        runMode: "motorstart",
        motorStarting: null,
        validation: [
          ...get().validation,
          { level: "error", message: "Selected starting motor no longer exists — pick another motor." },
        ],
      });
      return;
    }
    try {
      const result = runMotorStarting(get().exportProject(), motorId);
      set({ motorStarting: result, runMode: "motorstart" });
    } catch (err) {
      set({
        motorStarting: null,
        runMode: "motorstart",
        validation: [
          ...get().validation,
          {
            level: "error",
            message: err instanceof Error ? err.message : "Motor-starting solver error",
          },
        ],
      });
    }
  },

  clearResults: () => set({ loadFlow: null, shortCircuit: null, motorStarting: null, runMode: "idle" }),

  getSyntheticBuses: () => {
    try {
      const net = buildNetwork(get().exportProject());
      return net.buses
        .filter((b) => b.synthetic)
        .map((b) => ({
          id: b.id,
          label: b.label,
          memberComponentIds: b.memberComponentIds ?? [],
        }));
    } catch {
      return [];
    }
  },

  getRelayLinks: (relayId) =>
    resolveRelayLinks(relayId, get().components, get().connections),

  getRelayFaultCurrents: () => {
    const result = new Map<string, { primaryA: number; label: string }>();
    const sc = get().shortCircuit;
    if (!sc) return result;

    const components = get().components;
    const connections = get().connections;
    const relays = components.filter((c) => c.type === "relay");
    if (relays.length === 0) return result;

    let net;
    try {
      net = buildNetwork(get().exportProject());
    } catch {
      return result;
    }

    // Bus id that a given component lives on (via memberComponentIds).
    const busIdOfComponent = (compId: string): string | null => {
      const bus = net.buses.find((b) => b.memberComponentIds?.includes(compId));
      return bus ? bus.id : null;
    };

    for (const relay of relays) {
      const links = resolveRelayLinks(relay.id, components, connections);
      let primaryA: number | null = null;

      // Radial heuristic: the current through the breaker equals the fault
      // current of a branch incident to the breaker's bus, on the side facing
      // that bus. Consistent with the radial decomposition used for branchFlows.
      if (links.breakerId) {
        const busId = busIdOfComponent(links.breakerId);
        if (busId) {
          let best = 0;
          for (const bf of sc.branchFlows) {
            if (bf.fromBusId === busId) best = Math.max(best, bf.fromSideKa);
            else if (bf.toBusId === busId) best = Math.max(best, bf.toSideKa);
          }
          if (best > 0) primaryA = best * 1000;
        }
      }

      // Fallback: the fault-bus symmetrical current.
      if (primaryA === null) primaryA = sc.ikSymKa * 1000;

      result.set(relay.id, { primaryA, label: relay.label });
    }
    return result;
  },
}));
