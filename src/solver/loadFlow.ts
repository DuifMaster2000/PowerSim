// =====================================================================
// Newton-Raphson load flow solver.
// All math in per-unit on the project's MVA base.
//
// Bus types:
//   slack — V = 1.0 pu, angle = 0 (reference). Must be exactly one.
//   pq    — fixed P and Q load injections; V and angle solved.
//   pv    — fixed V = 1.0 pu, fixed scheduled P; angle solved.
//           Additional grid sources are modelled as PV buses.
// =====================================================================

import type {
  LoadFlowResult,
  LoadFlowOptions,
  IterationSnapshot,
  BusResult,
  BranchResult,
  LoadResult,
} from "../types";
import { buildYBus, type NetworkModel } from "./network";
import { solveLinear } from "./math";

const MAX_ITER = 30;
const TOL = 1e-6;

export function runLoadFlow(net: NetworkModel, opts?: LoadFlowOptions): LoadFlowResult {
  const n = net.buses.length;
  const captureHistory = opts?.captureHistory === true;
  const history: IterationSnapshot[] = [];

  if (n === 0) {
    return {
      converged: false,
      iterations: 0,
      message: "No busbars in network.",
      buses: [],
      branches: [],
      loads: [],
    };
  }
  if (net.slackBusIndex < 0) {
    return {
      converged: false,
      iterations: 0,
      message: "No grid source connected — slack bus missing.",
      buses: [],
      branches: [],
      loads: [],
    };
  }

  const { gRe, bIm } = buildYBus(net);

  // State vectors
  const V = new Array(n).fill(1.0);
  const theta = new Array(n).fill(0);

  // Specified P at each bus (load consumption is positive pPuLoad, so Pspec = -pPuLoad).
  // PV buses override with their scheduled injection.
  const Pspec = net.buses.map((b) => {
    if (b.busType === "pv") return b.pvScheduledPu;
    return -b.pPuLoad;
  });
  const Qspec = net.buses.map((b) => -b.qPuLoad);

  // Separate non-slack buses into PQ and PV lists.
  const pq: number[] = []; // PQ bus indices
  const pv: number[] = []; // PV bus indices
  for (let i = 0; i < n; i++) {
    if (i === net.slackBusIndex) continue;
    if (net.buses[i].busType === "pv") pv.push(i);
    else pq.push(i);
  }
  const npq = pq.length;
  const npv = pv.length;
  const m = 2 * npq + npv; // total unknowns / equations

  let iter = 0;
  let converged = false;
  let message: string | undefined;

  for (iter = 0; iter < MAX_ITER; iter++) {
    // Calculate P, Q at each bus from current V, theta
    const Pcalc = new Array(n).fill(0);
    const Qcalc = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let p = 0;
      let q = 0;
      for (let k = 0; k < n; k++) {
        const dt = theta[i] - theta[k];
        const cos = Math.cos(dt);
        const sin = Math.sin(dt);
        const G = gRe[i][k];
        const B = bIm[i][k];
        p += V[i] * V[k] * (G * cos + B * sin);
        q += V[i] * V[k] * (G * sin - B * cos);
      }
      Pcalc[i] = p;
      Qcalc[i] = q;
    }

    // Mismatch vector: [ΔP_pq..., ΔQ_pq..., ΔP_pv...]
    const dP_pq = pq.map((i) => Pspec[i] - Pcalc[i]);
    const dQ_pq = pq.map((i) => Qspec[i] - Qcalc[i]);
    const dP_pv = pv.map((i) => Pspec[i] - Pcalc[i]);

    const maxMis = Math.max(
      ...dP_pq.map(Math.abs),
      ...dQ_pq.map(Math.abs),
      ...dP_pv.map(Math.abs),
      0, // guard against empty arrays
    );
    if (captureHistory) {
      const densP = new Array(n).fill(0);
      const densQ = new Array(n).fill(0);
      pq.forEach((busIdx, k) => {
        densP[busIdx] = dP_pq[k];
        densQ[busIdx] = dQ_pq[k];
      });
      pv.forEach((busIdx, k) => {
        densP[busIdx] = dP_pv[k];
      });
      history.push({
        iter,
        V: V.slice(),
        theta: theta.slice(),
        mismatchP: densP,
        mismatchQ: densQ,
        maxMismatch: maxMis,
      });
    }
    if (maxMis < TOL) {
      converged = true;
      break;
    }

    // Build Jacobian (m × m)
    // State ordering: [Δθ_pq(0..npq-1), ΔV/V_pq(npq..2npq-1), Δθ_pv(2npq..2npq+npv-1)]
    // Equation ordering: [ΔP_pq(0..npq-1), ΔQ_pq(npq..2npq-1), ΔP_pv(2npq..2npq+npv-1)]
    const J: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));

    const allRows = [...pq, ...pq, ...pv]; // row bus indices: ΔP_pq, ΔQ_pq, ΔP_pv
    const allCols = [...pq, ...pq, ...pv]; // col bus indices (same layout for state vars)

    // Helper: fill one (row-bus, col-bus) entry given which sub-block it belongs to.
    // rowKind: 0=ΔP, 1=ΔQ
    // colKind: 0=Δθ, 1=ΔV/V
    const fillEntry = (
      row: number, // equation index in J
      col: number, // state index in J
      rowBus: number,
      colBus: number,
      rowKind: 0 | 1, // 0=P, 1=Q
      colKind: 0 | 1, // 0=theta, 1=V
    ) => {
      const i = rowBus;
      const j = colBus;
      const G = gRe[i][j];
      const B = bIm[i][j];
      const dt = theta[i] - theta[j];
      const cos = Math.cos(dt);
      const sin = Math.sin(dt);
      if (i !== j) {
        // Off-diagonal
        if (rowKind === 0 && colKind === 0) J[row][col] = V[i] * V[j] * (G * sin - B * cos);  // H
        if (rowKind === 0 && colKind === 1) J[row][col] = V[i] * V[j] * (G * cos + B * sin);  // N
        if (rowKind === 1 && colKind === 0) J[row][col] = -V[i] * V[j] * (G * cos + B * sin); // M
        if (rowKind === 1 && colKind === 1) J[row][col] = V[i] * V[j] * (G * sin - B * cos);  // L
      } else {
        // Diagonal
        if (rowKind === 0 && colKind === 0) J[row][col] = -Qcalc[i] - bIm[i][i] * V[i] * V[i]; // H
        if (rowKind === 0 && colKind === 1) J[row][col] = Pcalc[i] + gRe[i][i] * V[i] * V[i];  // N
        if (rowKind === 1 && colKind === 0) J[row][col] = Pcalc[i] - gRe[i][i] * V[i] * V[i];  // M
        if (rowKind === 1 && colKind === 1) J[row][col] = Qcalc[i] - bIm[i][i] * V[i] * V[i];  // L
      }
    };

    // ΔP_pq rows (0..npq-1), Δθ_pq cols (0..npq-1) → H block
    for (let ii = 0; ii < npq; ii++) {
      for (let jj = 0; jj < npq; jj++) {
        fillEntry(ii, jj, pq[ii], pq[jj], 0, 0);
      }
    }
    // ΔP_pq rows, ΔV/V_pq cols (npq..2npq-1) → N block
    for (let ii = 0; ii < npq; ii++) {
      for (let jj = 0; jj < npq; jj++) {
        fillEntry(ii, npq + jj, pq[ii], pq[jj], 0, 1);
      }
    }
    // ΔP_pq rows, Δθ_pv cols (2npq..2npq+npv-1) → H cross-block
    for (let ii = 0; ii < npq; ii++) {
      for (let jj = 0; jj < npv; jj++) {
        fillEntry(ii, 2 * npq + jj, pq[ii], pv[jj], 0, 0);
      }
    }
    // ΔQ_pq rows (npq..2npq-1), Δθ_pq cols → M block
    for (let ii = 0; ii < npq; ii++) {
      for (let jj = 0; jj < npq; jj++) {
        fillEntry(npq + ii, jj, pq[ii], pq[jj], 1, 0);
      }
    }
    // ΔQ_pq rows, ΔV/V_pq cols → L block
    for (let ii = 0; ii < npq; ii++) {
      for (let jj = 0; jj < npq; jj++) {
        fillEntry(npq + ii, npq + jj, pq[ii], pq[jj], 1, 1);
      }
    }
    // ΔQ_pq rows, Δθ_pv cols → M cross-block
    for (let ii = 0; ii < npq; ii++) {
      for (let jj = 0; jj < npv; jj++) {
        fillEntry(npq + ii, 2 * npq + jj, pq[ii], pv[jj], 1, 0);
      }
    }
    // ΔP_pv rows (2npq..2npq+npv-1), Δθ_pq cols
    for (let ii = 0; ii < npv; ii++) {
      for (let jj = 0; jj < npq; jj++) {
        fillEntry(2 * npq + ii, jj, pv[ii], pq[jj], 0, 0);
      }
    }
    // ΔP_pv rows, ΔV/V_pq cols
    for (let ii = 0; ii < npv; ii++) {
      for (let jj = 0; jj < npq; jj++) {
        fillEntry(2 * npq + ii, npq + jj, pv[ii], pq[jj], 0, 1);
      }
    }
    // ΔP_pv rows, Δθ_pv cols
    for (let ii = 0; ii < npv; ii++) {
      for (let jj = 0; jj < npv; jj++) {
        fillEntry(2 * npq + ii, 2 * npq + jj, pv[ii], pv[jj], 0, 0);
      }
    }

    const rhs = [...dP_pq, ...dQ_pq, ...dP_pv];

    let delta: number[];
    try {
      delta = solveLinear(J, rhs);
    } catch {
      message = "Jacobian became singular — load flow failed to converge.";
      break;
    }

    // Apply updates
    for (let ii = 0; ii < npq; ii++) {
      const i = pq[ii];
      theta[i] += delta[ii];
      V[i] *= 1 + delta[npq + ii];
    }
    for (let ii = 0; ii < npv; ii++) {
      const i = pv[ii];
      theta[i] += delta[2 * npq + ii];
      // V stays fixed at 1.0 for PV buses
    }

    // Divergence check
    for (let i = 0; i < n; i++) {
      if (!isFinite(V[i]) || V[i] < 0.5 || V[i] > 2.0) {
        return {
          converged: false,
          iterations: iter + 1,
          message: "Voltage diverged (V out of [0.5, 2.0] pu) — check network topology and loading.",
          buses: [],
          branches: [],
          loads: [],
        };
      }
    }
  }

  if (!converged && !message) {
    message = `Did not converge in ${MAX_ITER} iterations.`;
  }

  // Build results
  const busResults: BusResult[] = net.buses.map((b, i) => ({
    busId: b.id,
    label: b.label,
    nominalKv: b.nominalKv,
    voltageKv: V[i] * b.baseKv,
    voltagePu: V[i],
    angleDeg: (theta[i] * 180) / Math.PI,
  }));

  const branchResults: BranchResult[] = net.branches.map((br) => {
    const i = br.fromBus;
    const j = br.toBus;
    const Vi_re = V[i] * Math.cos(theta[i]);
    const Vi_im = V[i] * Math.sin(theta[i]);
    const Vj_re = V[j] * Math.cos(theta[j]);
    const Vj_im = V[j] * Math.sin(theta[j]);
    const dV_re = Vi_re - Vj_re;
    const dV_im = Vi_im - Vj_im;
    const yr = br.yPu.re;
    const yi = br.yPu.im;
    const I_re = yr * dV_re - yi * dV_im;
    const I_im = yr * dV_im + yi * dV_re;
    const Imag = Math.hypot(I_re, I_im);

    const S_re = Vi_re * I_re + Vi_im * I_im;
    const S_im = Vi_im * I_re - Vi_re * I_im;
    const pMw = S_re * net.baseMva;
    const qMvar = S_im * net.baseMva;

    const fromKv = net.buses[i].baseKv;
    const IbaseA = (net.baseMva * 1000) / (Math.sqrt(3) * fromKv);
    const currentA = Imag * IbaseA;

    let loadingPercent = 0;
    if (br.ratedAmps && br.ratedAmps > 0) {
      loadingPercent = (currentA / br.ratedAmps) * 100;
    } else if (br.componentType === "transformer" && br.ratedMva && br.ratedMva > 0) {
      const sApparentMva = Math.hypot(pMw, qMvar);
      loadingPercent = (sApparentMva / br.ratedMva) * 100;
    }

    return {
      branchId: br.id,
      label: br.label,
      componentType: br.componentType,
      fromBus: net.buses[i].id,
      toBus: net.buses[j].id,
      currentA,
      loadingPercent,
      pMw,
      qMvar,
    };
  });

  // Per-load currents: I = S_kVA / (√3 · V_LL_kV). For loads, S uses the
  // configured P+Q; for motors, the electrical (terminal) P+Q from network.ts.
  const loadResults: LoadResult[] = [];
  for (const ld of net.loads) {
    const vKv = busResults[ld.busIndex].voltageKv;
    const sKva = Math.hypot(ld.pKw, ld.qKvar);
    const currentA = vKv > 0 ? (sKva * 1000) / (Math.sqrt(3) * vKv * 1000) : 0;
    loadResults.push({
      loadId: ld.componentId,
      label: ld.label,
      componentType: "load",
      busId: net.buses[ld.busIndex].id,
      currentA,
      pKw: ld.pKw,
      qKvar: ld.qKvar,
    });
  }
  for (const m of net.motors) {
    const vKv = busResults[m.busIndex].voltageKv;
    const sKva = Math.hypot(m.electricalKw, m.electricalKvar);
    const currentA = vKv > 0 ? (sKva * 1000) / (Math.sqrt(3) * vKv * 1000) : 0;
    loadResults.push({
      loadId: m.componentId,
      label: m.label,
      componentType: "motor",
      busId: net.buses[m.busIndex].id,
      currentA,
      pKw: m.electricalKw,
      qKvar: m.electricalKvar,
    });
  }

  return {
    converged,
    iterations: iter + 1,
    message,
    buses: busResults,
    branches: branchResults,
    loads: loadResults,
    ...(captureHistory ? { history } : {}),
  };
}
