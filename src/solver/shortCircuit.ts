// =====================================================================
// IEC 60909 simplified three-phase short-circuit solver.
// - Three-phase symmetrical bolted fault only
// - Transformer impedance correction K_T = 0.95·c/(1+0.6·x_T) is applied
//   (short-circuit path only). Generator/power-station correction (Kg, Ks)
//   is still omitted — documented simplification.
// - Voltage factor c: 1.10 for maximum fault current, 1.05 for minimum
// =====================================================================

import type { ShortCircuitResult, ShortCircuitContribution, ShortCircuitBranchFlow } from "../types";
import type { NetworkModel } from "./network";
import { buildYBus } from "./network";
import { invertComplexMatrix, type Complex, cAbs } from "./math";

export function runShortCircuit(
  net: NetworkModel,
  faultBusIndex: number,
  cFactor: number = 1.1,
): ShortCircuitResult {
  const n = net.buses.length;
  if (faultBusIndex < 0 || faultBusIndex >= n) {
    throw new Error("Invalid fault bus index");
  }

  // Build Y-bus with source impedances ADDED at each source's bus. The fault
  // path applies the IEC 60909 transformer correction K_T (load flow does not).
  const { gRe, bIm } = buildYBus(net, { scCFactor: cFactor });
  for (const src of net.sources) {
    // Y_src = 1 / Z_src
    const r = src.zSrcPu.re;
    const x = src.zSrcPu.im;
    const denom = r * r + x * x;
    const yRe = r / denom;
    const yIm = -x / denom;
    gRe[src.busIndex][src.busIndex] += yRe;
    bIm[src.busIndex][src.busIndex] += yIm;
  }
  // Add motor admittances too (motors contribute fault current)
  for (const m of net.motors) {
    const r = m.zMotPu.re;
    const x = m.zMotPu.im;
    const denom = r * r + x * x;
    const yRe = r / denom;
    const yIm = -x / denom;
    gRe[m.busIndex][m.busIndex] += yRe;
    bIm[m.busIndex][m.busIndex] += yIm;
  }

  // Invert: Z = Y^-1
  const { re: zRe, im: zIm } = invertComplexMatrix(gRe, bIm);

  // I_k"(pu) = c / |Z_kk|
  const zkk_re = zRe[faultBusIndex][faultBusIndex];
  const zkk_im = zIm[faultBusIndex][faultBusIndex];
  const zkk_mag = Math.hypot(zkk_re, zkk_im);
  const Ipu = cFactor / zkk_mag;

  // Convert to amps: I_base = baseMva * 1000 / (√3 × baseKv_kV)
  const faultBus = net.buses[faultBusIndex];
  const Ibase = (net.baseMva * 1000) / (Math.sqrt(3) * faultBus.baseKv);
  const ikSymKa = (Ipu * Ibase) / 1000;

  // Network X/R at fault bus = im / re of Z_kk (approximation)
  const xrAtFault = Math.abs(zkk_im) / Math.max(Math.abs(zkk_re), 1e-9);
  // κ factor for peak current — IEC 60909 standard formula
  const kappa = 1.02 + 0.98 * Math.exp(-3 / xrAtFault);
  const ipPeakKa = kappa * Math.sqrt(2) * ikSymKa;

  // Source contributions:
  //   I_source(pu) = c × V_source / (Z_src + Z_thev_from_src_to_fault)
  // Simplification: each source's contribution scales as its admittance to fault bus.
  // We approximate: contribution_k = (admittance_to_fault_k / total_admittance) × I_k"
  // A more rigorous method uses superposition with the full Z-bus, but for v1 we use:
  //   For each source on bus s: V_s_pre = c, and I_contrib = c / |Z_ss + Z_kk - 2*Z_sk|… too complex.
  // Use a simpler rule: contribution ∝ 1 / |Z_src| for sources directly,
  // distributed by how much voltage drop each one sees.
  //
  // Practical approach we'll implement:
  //   Open-circuit Thevenin voltage at fault bus = c (per unit).
  //   For each source on bus s, the contribution is approximately:
  //     I_s(pu) = (V_pre_s - V_fault_during) × y_path_s_to_fault
  //   where V_fault_during = 0 (bolted fault) and V_pre_s ≈ c × Z_sk / Z_kk
  // So:
  //     I_s(pu) ≈ c × Z_sk / (Z_kk × Z_src_s)  — magnitude only
  //
  // We compute |Z_sk|, |Z_src_s|, |Z_kk| and use this.

  const contributions: ShortCircuitContribution[] = [];
  // Accumulate the per-unit injection from every source/motor at its bus.
  // Reused below to compute fault-path current on every branch.
  const contribPuByBus: number[] = new Array(n).fill(0);

  for (const src of net.sources) {
    const s = src.busIndex;
    const zsk_re = zRe[s][faultBusIndex];
    const zsk_im = zIm[s][faultBusIndex];
    const zsk_mag = Math.hypot(zsk_re, zsk_im);
    const zsrc_mag = cAbs(src.zSrcPu);
    // Contribution magnitude (pu)
    const Icontrib_pu = (cFactor * zsk_mag) / (zkk_mag * zsrc_mag);
    contribPuByBus[s] += Icontrib_pu;
    const IbaseSrc = (net.baseMva * 1000) / (Math.sqrt(3) * net.buses[s].baseKv);
    const IcontribKa = (Icontrib_pu * IbaseSrc) / 1000;
    contributions.push({
      sourceId: src.componentId,
      label: src.label,
      currentKa: IcontribKa,
    });
  }

  for (const m of net.motors) {
    const s = m.busIndex;
    const zsk_re = zRe[s][faultBusIndex];
    const zsk_im = zIm[s][faultBusIndex];
    const zsk_mag = Math.hypot(zsk_re, zsk_im);
    const zmot_mag = cAbs(m.zMotPu);
    const Icontrib_pu = (cFactor * zsk_mag) / (zkk_mag * zmot_mag);
    contribPuByBus[s] += Icontrib_pu;
    const IbaseMot = (net.baseMva * 1000) / (Math.sqrt(3) * net.buses[s].baseKv);
    const IcontribKa = (Icontrib_pu * IbaseMot) / 1000;
    contributions.push({
      sourceId: m.componentId,
      label: m.label,
      currentKa: IcontribKa,
    });
  }

  // Per-branch fault path: cut each branch one at a time, BFS the rest, and
  // total the per-unit injections living on the non-fault side. That total
  // (in pu) is the magnitude of the current the branch carries during the
  // fault. Multiply by each end's base current to display amps at the right
  // voltage on each side of a transformer. Exact for radial networks; an
  // approximation for meshed ones (the same approximation used for the
  // per-source contributions above).
  const adjBranches: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < net.branches.length; i++) {
    adjBranches[net.branches[i].fromBus].push(i);
    adjBranches[net.branches[i].toBus].push(i);
  }

  const branchFlows: ShortCircuitBranchFlow[] = [];
  for (let bi = 0; bi < net.branches.length; bi++) {
    const br = net.branches[bi];
    if (br.componentType !== "transformer" && br.componentType !== "cable") continue;

    const visited = new Set<number>([br.fromBus]);
    const queue: number[] = [br.fromBus];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const adj of adjBranches[cur]) {
        if (adj === bi) continue;
        const adjBr = net.branches[adj];
        const other = adjBr.fromBus === cur ? adjBr.toBus : adjBr.fromBus;
        if (!visited.has(other)) {
          visited.add(other);
          queue.push(other);
        }
      }
    }

    let fromSideKa = 0;
    let toSideKa = 0;
    const faultOnFromSide = visited.has(faultBusIndex);
    // Only meaningful when the branch is a true cut. When the network has a
    // loop that still connects both ends after removing this branch, we leave
    // the kA at 0 — the radial-superposition approximation doesn't apply.
    if (!visited.has(br.toBus)) {
      let totalPu = 0;
      for (let b = 0; b < n; b++) {
        const inFromSet = visited.has(b);
        const onNonFaultSide = faultOnFromSide ? !inFromSet : inFromSet;
        if (onNonFaultSide) totalPu += contribPuByBus[b];
      }
      const IbaseFrom = (net.baseMva * 1000) / (Math.sqrt(3) * net.buses[br.fromBus].baseKv);
      const IbaseTo = (net.baseMva * 1000) / (Math.sqrt(3) * net.buses[br.toBus].baseKv);
      fromSideKa = (totalPu * IbaseFrom) / 1000;
      toSideKa = (totalPu * IbaseTo) / 1000;
    }

    branchFlows.push({
      branchId: br.id,
      componentType: br.componentType,
      fromBusId: net.buses[br.fromBus].id,
      toBusId: net.buses[br.toBus].id,
      fromSideKa,
      toSideKa,
      faultOnFromSide,
    });
  }

  return {
    faultBusId: faultBus.id,
    faultBusLabel: faultBus.label,
    ikSymKa,
    ipPeakKa,
    contributions,
    branchFlows,
  };
}
