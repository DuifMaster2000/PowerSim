// =====================================================================
// Network builder: transforms a project (components + connections) into
// a solver-ready network model (buses, branches, injections, Y-bus).
// =====================================================================

import type {
  Connection,
  PowerComponent,
  ProjectFile,
  GridSourceParams,
  TransformerParams,
  CableParams,
  LoadParams,
  MotorParams,
  MotorStartingMethod,
  SwitchParams,
  FuseParams,
  BusbarParams,
} from "../types";
import { C, type Complex, cInv, cAdd } from "./math";

/**
 * For a chosen starting method, return the effective starting-current
 * multiplier of full-load amps. Constrained so soft-starter / star-delta /
 * VFD can never exceed the motor's intrinsic locked-rotor capability.
 */
export function effectiveStartingCurrentRatio(
  method: MotorStartingMethod,
  lockedRotorRatio: number,
): number {
  switch (method) {
    case "DOL": return lockedRotorRatio;
    case "star-delta": return lockedRotorRatio / 3;
    case "soft-starter": return Math.min(lockedRotorRatio, 3.5);
    case "VFD": return Math.min(lockedRotorRatio, 1.1);
  }
}

export interface BranchModel {
  id: string;
  label: string;
  fromBus: number; // index into buses[]
  toBus: number;
  yPu: Complex; // series admittance in per-unit on system base
  ratedAmps?: number; // for loading % calculation (cable ampacity)
  ratedMva?: number; // for loading % calculation (transformer rated MVA)
  componentType: "transformer" | "cable" | "switch";
  fromKvBase?: number; // base kV at the from-bus (for current conversion)
}

export interface BusModel {
  id: string; // component id of the busbar, or "node-..." for synthetic buses
  label: string;
  nominalKv: number; // user-set nominal voltage
  baseKv: number; // per-unit base voltage (may equal nominal or be derived via transformers)
  pPuLoad: number; // injected P (load + motor, in PU on system base) — negative of generation
  qPuLoad: number;
  busType: "slack" | "pq" | "pv";
  pvScheduledPu: number; // scheduled P injection (pu) for PV buses; 0 for slack/pq
  shuntYPu: Complex; // bus shunt admittance (used to model a starting motor's locked-rotor impedance)
  synthetic?: boolean; // true if no real busbar exists for this bus
  memberComponentIds?: string[]; // unique component ids whose terminals live on this bus (for canvas-side dot positioning)
}

export interface SourceModel {
  componentId: string;
  label: string;
  busIndex: number;
  nominalKv: number;
  shortCircuitMva: number;
  xrRatio: number;
  zSrcPu: Complex; // source impedance referred to system base
}

export interface MotorModel {
  componentId: string;
  label: string;
  busIndex: number;
  ratedKw: number;
  powerFactor: number;
  electricalKw: number; // P drawn at terminals (incl. losses)
  electricalKvar: number;
  zMotPu: Complex; // motor short-circuit impedance (subtransient) in PU on system base
}

export interface LoadModel {
  componentId: string;
  label: string;
  busIndex: number;
  pKw: number;
  qKvar: number;
}

export interface NetworkModel {
  baseMva: number;
  buses: BusModel[];
  branches: BranchModel[];
  sources: SourceModel[];
  motors: MotorModel[];
  loads: LoadModel[];
  slackBusIndex: number;
  busIndexById: Map<string, number>;
}

export interface BuildNetworkOptions {
  /**
   * Component id of a motor to model in its starting (locked-rotor) state.
   * That motor's normal PQ injection is replaced by a constant shunt
   * admittance computed from its starting method and starting PF.
   */
  startingMotorId?: string;
}

/**
 * Build the solver network model from a project file.
 *
 * Topology model (since v0.4): the project is treated as a graph of component
 * terminals. Two terminals are in the same "electrical bus" if connected by
 * any combination of:
 *   - direct wires (connections)
 *   - closed switches (which unify their own in↔out terminals — transparent)
 *   - busbars (which unify their own top↔bottom — one logical node)
 * Cables and transformers SEPARATE buses — they have a real impedance with
 * two distinct electrical sides. Open switches do NOT unify their terminals,
 * which naturally isolates the downstream side.
 *
 * Each equivalence class of terminals becomes a BusModel. If a class contains
 * a real busbar component, that busbar's label / nominal voltage are used.
 * Otherwise the class becomes a "synthetic" bus, named after the components
 * living on it (e.g. a motor wired directly to a cable end).
 */
export function buildNetwork(
  project: ProjectFile,
  options: BuildNetworkOptions = {},
): NetworkModel {
  const baseMva = project.system.base_mva;
  const components = project.components;
  const compById = new Map(components.map((c) => [c.id, c]));
  const startingMotorId = options.startingMotorId;

  // 1. Filter out open switches and blown fuses from the active topology.
  //    A blown fuse is electrically equivalent to an open switch.
  const activeConnections: Connection[] = [];
  for (const conn of project.connections) {
    const a = compById.get(conn.fromComponent);
    const b = compById.get(conn.toComponent);
    if (!a || !b) continue;
    // Relay/CT control wires carry no power — exclude them from the electrical
    // topology entirely so they never merge or create buses.
    if (a.type === "relay" || a.type === "ct" || b.type === "relay" || b.type === "ct") continue;
    if (a.type === "switch" && !(a.parameters as SwitchParams).closed) continue;
    if (b.type === "switch" && !(b.parameters as SwitchParams).closed) continue;
    if (a.type === "fuse" && !(a.parameters as FuseParams).intact) continue;
    if (b.type === "fuse" && !(b.parameters as FuseParams).intact) continue;
    activeConnections.push(conn);
  }

  // 2. Terminal-level union-find.
  type TK = string; // "componentId:terminalId"
  const tk = (compId: string, term: string): TK => `${compId}:${term}`;
  const parent = new Map<TK, TK>();
  const registerTerminal = (k: TK) => { if (!parent.has(k)) parent.set(k, k); };
  const find = (k: TK): TK => {
    registerTerminal(k);
    let root = k;
    while (parent.get(root)! !== root) root = parent.get(root)!;
    // Path compression
    let cur = k;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: TK, b: TK) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Pre-register every terminal we'll need to query later, so even
  // disconnected components produce a defined "no bus" answer.
  for (const c of components) {
    switch (c.type) {
      case "busbar": registerTerminal(tk(c.id, "top")); registerTerminal(tk(c.id, "bottom")); break;
      case "transformer": registerTerminal(tk(c.id, "primary")); registerTerminal(tk(c.id, "secondary")); break;
      case "cable": registerTerminal(tk(c.id, "from")); registerTerminal(tk(c.id, "to")); break;
      case "switch":
      case "fuse": registerTerminal(tk(c.id, "in")); registerTerminal(tk(c.id, "out")); break;
      case "grid_source": registerTerminal(tk(c.id, "out")); break;
      case "load":
      case "motor": registerTerminal(tk(c.id, "in")); break;
    }
  }

  // Within-component unifications (passthrough types).
  for (const c of components) {
    if (c.type === "busbar") {
      union(tk(c.id, "top"), tk(c.id, "bottom"));
    } else if (c.type === "switch") {
      const sw = c.parameters as SwitchParams;
      if (sw.closed) union(tk(c.id, "in"), tk(c.id, "out"));
      // Open: NOT unified → break in the circuit
    } else if (c.type === "fuse") {
      const f = c.parameters as FuseParams;
      if (f.intact) union(tk(c.id, "in"), tk(c.id, "out"));
      // Blown: NOT unified → break in the circuit
    }
  }

  // Wire unifications (every active connection).
  for (const conn of activeConnections) {
    union(tk(conn.fromComponent, conn.fromTerminal), tk(conn.toComponent, conn.toTerminal));
  }

  // 3. Collect equivalence classes → one bus per class.
  const classMembers = new Map<TK, TK[]>();
  for (const k of parent.keys()) {
    const r = find(k);
    if (!classMembers.has(r)) classMembers.set(r, []);
    classMembers.get(r)!.push(k);
  }

  const buses: BusModel[] = [];
  const classToBusIdx = new Map<TK, number>();
  for (const [root, members] of classMembers) {
    const compIds = Array.from(new Set(members.map((m) => m.split(":")[0])));
    const busbarComp = compIds.map((id) => compById.get(id)).find((c) => c?.type === "busbar");

    if (busbarComp) {
      const p = busbarComp.parameters as BusbarParams;
      buses.push({
        id: busbarComp.id,
        label: busbarComp.label,
        nominalKv: p.nominal_voltage_kv,
        baseKv: p.nominal_voltage_kv,
        pPuLoad: 0,
        qPuLoad: 0,
        busType: "pq",
        pvScheduledPu: 0,
        shuntYPu: C(0, 0),
        memberComponentIds: compIds,
      });
    } else {
      // Synthetic bus — label it after the components living on it.
      const onClass = compIds
        .map((id) => compById.get(id))
        .filter((c): c is PowerComponent => !!c);
      const terminalSide = onClass.find((c) => c.type === "motor" || c.type === "load" || c.type === "grid_source");
      const labelBase = terminalSide
        ? `${terminalSide.label}`
        : onClass.map((c) => c.label).slice(0, 2).join("·") || `node-${buses.length + 1}`;
      buses.push({
        id: `node-${root.replace(/[:]/g, "_")}`,
        label: `${labelBase} node`,
        nominalKv: 0, // resolved by base-kV propagation below
        baseKv: 0,
        pPuLoad: 0,
        qPuLoad: 0,
        busType: "pq",
        pvScheduledPu: 0,
        shuntYPu: C(0, 0),
        synthetic: true,
        memberComponentIds: compIds,
      });
    }
    classToBusIdx.set(root, buses.length - 1);
  }
  const busIndexById = new Map(buses.map((b, i) => [b.id, i]));

  // Lookup: which bus index sits behind (componentId, terminalId)?
  const busOf = (compId: string, term: string): number | undefined => {
    const k = tk(compId, term);
    if (!parent.has(k)) return undefined;
    return classToBusIdx.get(find(k));
  };

  // 4. Grid sources → slack + PV buses.
  const sources: SourceModel[] = [];
  let slackBusIndex = -1;
  for (const comp of components) {
    if (comp.type !== "grid_source") continue;
    const busIdx = busOf(comp.id, "out");
    if (busIdx === undefined) continue;
    const p = comp.parameters as GridSourceParams;
    const zMag = baseMva / p.short_circuit_mva;
    const x = (zMag * p.xr_ratio) / Math.sqrt(1 + p.xr_ratio * p.xr_ratio);
    const r = zMag / Math.sqrt(1 + p.xr_ratio * p.xr_ratio);
    sources.push({
      componentId: comp.id,
      label: comp.label,
      busIndex: busIdx,
      nominalKv: p.nominal_voltage_kv,
      shortCircuitMva: p.short_circuit_mva,
      xrRatio: p.xr_ratio,
      zSrcPu: C(r, x),
    });
    buses[busIdx].baseKv = p.nominal_voltage_kv;
    if (buses[busIdx].nominalKv === 0) buses[busIdx].nominalKv = p.nominal_voltage_kv;
    if (slackBusIndex === -1) {
      slackBusIndex = busIdx;
      buses[busIdx].busType = "slack";
    } else {
      buses[busIdx].busType = "pv";
      buses[busIdx].pvScheduledPu = (p.scheduled_mw ?? 0) / baseMva;
    }
  }

  // 5. Branch topology (transformers + cables only — switches are absorbed
  //    into bus classes and never appear as branches in the solver model).
  interface BranchTopology {
    comp: PowerComponent;
    fromBus: number;
    toBus: number;
  }
  const txTopo: BranchTopology[] = [];
  const cableTopo: BranchTopology[] = [];
  for (const comp of components) {
    if (comp.type === "transformer") {
      const fromIdx = busOf(comp.id, "primary");
      const toIdx = busOf(comp.id, "secondary");
      if (fromIdx === undefined || toIdx === undefined || fromIdx === toIdx) continue;
      txTopo.push({ comp, fromBus: fromIdx, toBus: toIdx });
    } else if (comp.type === "cable") {
      const fromIdx = busOf(comp.id, "from");
      const toIdx = busOf(comp.id, "to");
      if (fromIdx === undefined || toIdx === undefined || fromIdx === toIdx) continue;
      cableTopo.push({ comp, fromBus: fromIdx, toBus: toIdx });
    }
  }

  // 6. Propagate base kV from the slack bus through transformers (which
  //    change voltage by ratio) and cables (which keep it).
  if (slackBusIndex >= 0) {
    const visited = new Set<number>([slackBusIndex]);
    const queue = [slackBusIndex];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const tt of txTopo) {
        const txp = tt.comp.parameters as TransformerParams;
        const step = (from: number, to: number) => {
          const ratio = buses[from].baseKv === txp.primary_kv
            ? txp.secondary_kv / txp.primary_kv
            : txp.primary_kv / txp.secondary_kv;
          buses[to].baseKv = buses[from].baseKv * ratio;
          if (buses[to].nominalKv === 0) buses[to].nominalKv = buses[to].baseKv;
          visited.add(to);
          queue.push(to);
        };
        if (tt.fromBus === cur && !visited.has(tt.toBus)) step(tt.fromBus, tt.toBus);
        else if (tt.toBus === cur && !visited.has(tt.fromBus)) step(tt.toBus, tt.fromBus);
      }
      for (const ct of cableTopo) {
        const carry = (from: number, to: number) => {
          buses[to].baseKv = buses[from].baseKv;
          if (buses[to].nominalKv === 0) buses[to].nominalKv = buses[to].baseKv;
          visited.add(to);
          queue.push(to);
        };
        if (ct.fromBus === cur && !visited.has(ct.toBus)) carry(ct.fromBus, ct.toBus);
        else if (ct.toBus === cur && !visited.has(ct.fromBus)) carry(ct.toBus, ct.fromBus);
      }
    }
  }

  // 7. Compute branch admittances (now baseKv is known on every reachable bus).
  const branches: BranchModel[] = [];
  for (const tt of txTopo) {
    const p = tt.comp.parameters as TransformerParams;
    const zPu = (p.impedance_percent / 100) * (baseMva / p.rated_mva);
    const x = (zPu * p.xr_ratio) / Math.sqrt(1 + p.xr_ratio * p.xr_ratio);
    const r = zPu / Math.sqrt(1 + p.xr_ratio * p.xr_ratio);
    branches.push({
      id: tt.comp.id,
      label: tt.comp.label,
      fromBus: tt.fromBus,
      toBus: tt.toBus,
      yPu: cInv(C(r, x)),
      ratedMva: p.rated_mva,
      componentType: "transformer",
    });
  }
  for (const ct of cableTopo) {
    const p = ct.comp.parameters as CableParams;
    const lenKm = p.length_m / 1000;
    const rOhm = p.resistance_ohm_per_km * lenKm;
    const xOhm = p.reactance_ohm_per_km * lenKm;
    // Fallback to 1 kV if both ends are still 0 (orphaned cable); harmless because
    // an orphaned branch will be filtered out below.
    const fromBaseKv = buses[ct.fromBus].baseKv || buses[ct.toBus].baseKv || 1;
    const baseZ = (fromBaseKv * fromBaseKv) / baseMva;
    const rPu = rOhm / baseZ;
    const xPu = xOhm / baseZ;
    branches.push({
      id: ct.comp.id,
      label: ct.comp.label,
      fromBus: ct.fromBus,
      toBus: ct.toBus,
      yPu: cInv(C(rPu, xPu)),
      ratedAmps: p.ampacity_a,
      componentType: "cable",
      fromKvBase: fromBaseKv,
    });
  }

  // 8. Loads and motors — assign to their bus class, accumulate PU injections.
  const motors: MotorModel[] = [];
  const loads: LoadModel[] = [];
  for (const comp of components) {
    if (comp.type === "load") {
      const busIdx = busOf(comp.id, "in");
      if (busIdx === undefined) continue;
      const p = comp.parameters as LoadParams;
      buses[busIdx].pPuLoad += p.active_power_kw / 1000 / baseMva;
      buses[busIdx].qPuLoad += p.reactive_power_kvar / 1000 / baseMva;
      loads.push({
        componentId: comp.id,
        label: comp.label,
        busIndex: busIdx,
        pKw: p.active_power_kw,
        qKvar: p.reactive_power_kvar,
      });
    } else if (comp.type === "motor") {
      const busIdx = busOf(comp.id, "in");
      if (busIdx === undefined) continue;
      const p = comp.parameters as MotorParams;
      const electricalKw = p.rated_kw / p.efficiency;
      const electricalMva = electricalKw / 1000 / p.power_factor;
      const motorMw = electricalMva * p.power_factor;
      const motorMvar = electricalMva * Math.sin(Math.acos(p.power_factor));

      if (comp.id === startingMotorId) {
        const method = p.starting_method ?? "DOL"; // legacy v0.3 fallback
        const startPf = p.starting_pf ?? 0.2;
        const factor = effectiveStartingCurrentRatio(method, p.locked_rotor_current_ratio);
        const sStartPu = factor * (electricalMva / baseMva);
        if (sStartPu > 0) {
          const zMag = 1 / sStartPu;
          const pf = Math.min(1, Math.max(0.01, startPf));
          const sinPhi = Math.sqrt(Math.max(0, 1 - pf * pf));
          const r = zMag * pf;
          const x = zMag * sinPhi;
          const denom = r * r + x * x;
          buses[busIdx].shuntYPu = cAdd(buses[busIdx].shuntYPu, C(r / denom, -x / denom));
        }
      } else {
        buses[busIdx].pPuLoad += motorMw / baseMva;
        buses[busIdx].qPuLoad += motorMvar / baseMva;
      }
      const zMotMag = (1 / p.locked_rotor_current_ratio) * (baseMva / electricalMva);
      const motorXR = 6;
      const x = (zMotMag * motorXR) / Math.sqrt(1 + motorXR * motorXR);
      const r = zMotMag / Math.sqrt(1 + motorXR * motorXR);
      motors.push({
        componentId: comp.id,
        label: comp.label,
        busIndex: busIdx,
        ratedKw: p.rated_kw,
        powerFactor: p.power_factor,
        electricalKw: motorMw * 1000,
        electricalKvar: motorMvar * 1000,
        zMotPu: C(r, x),
      });
    }
  }

  // 9. Drop orphan buses (not reachable from the slack bus via branches).
  //    Common when the user has opened a CB to isolate a section — the
  //    isolated nodes would otherwise create a singular Jacobian.
  if (slackBusIndex >= 0) {
    const reachable = new Set<number>([slackBusIndex]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const br of branches) {
        if (reachable.has(br.fromBus) && !reachable.has(br.toBus)) { reachable.add(br.toBus); changed = true; }
        else if (reachable.has(br.toBus) && !reachable.has(br.fromBus)) { reachable.add(br.fromBus); changed = true; }
      }
    }
    if (reachable.size < buses.length) {
      const oldToNew = new Map<number, number>();
      const newBuses: BusModel[] = [];
      for (let i = 0; i < buses.length; i++) {
        if (reachable.has(i)) {
          oldToNew.set(i, newBuses.length);
          newBuses.push(buses[i]);
        }
      }
      const remap = (i: number) => oldToNew.get(i)!;
      const newBranches = branches.filter((b) => reachable.has(b.fromBus) && reachable.has(b.toBus))
        .map((b) => ({ ...b, fromBus: remap(b.fromBus), toBus: remap(b.toBus) }));
      const newSources = sources.filter((s) => reachable.has(s.busIndex)).map((s) => ({ ...s, busIndex: remap(s.busIndex) }));
      const newMotors = motors.filter((m) => reachable.has(m.busIndex)).map((m) => ({ ...m, busIndex: remap(m.busIndex) }));
      const newLoads = loads.filter((l) => reachable.has(l.busIndex)).map((l) => ({ ...l, busIndex: remap(l.busIndex) }));
      const newSlack = remap(slackBusIndex);
      const newBusIndexById = new Map(newBuses.map((b, i) => [b.id, i]));
      return {
        baseMva,
        buses: newBuses,
        branches: newBranches,
        sources: newSources,
        motors: newMotors,
        loads: newLoads,
        slackBusIndex: newSlack,
        busIndexById: newBusIndexById,
      };
    }
  }

  return {
    baseMva,
    buses,
    branches,
    sources,
    motors,
    loads,
    slackBusIndex,
    busIndexById,
  };
}

/**
 * Build the Y-bus admittance matrix (real and imaginary parts) for the network.
 * Source impedances are NOT added here — they're added separately for fault analysis.
 */
export function buildYBus(net: NetworkModel): { gRe: number[][]; bIm: number[][] } {
  const n = net.buses.length;
  const gRe: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const bIm: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const br of net.branches) {
    const i = br.fromBus;
    const j = br.toBus;
    // Off-diagonals: -y
    gRe[i][j] -= br.yPu.re;
    gRe[j][i] -= br.yPu.re;
    bIm[i][j] -= br.yPu.im;
    bIm[j][i] -= br.yPu.im;
    // Diagonals: +y
    gRe[i][i] += br.yPu.re;
    gRe[j][j] += br.yPu.re;
    bIm[i][i] += br.yPu.im;
    bIm[j][j] += br.yPu.im;
  }
  // Bus shunt admittances (e.g. a starting motor's locked-rotor impedance)
  // add to the diagonal only.
  for (let i = 0; i < n; i++) {
    gRe[i][i] += net.buses[i].shuntYPu.re;
    bIm[i][i] += net.buses[i].shuntYPu.im;
  }
  return { gRe, bIm };
}
