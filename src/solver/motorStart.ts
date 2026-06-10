// =====================================================================
// Motor starting analysis.
// Runs two load flows:
//   1. Pre-start  — all motors in normal (running) PQ mode
//   2. During-start — the selected motor is replaced with its locked-rotor
//                     impedance (constant shunt admittance), modelling
//                     inrush at low power factor
// Reports the per-bus voltage dip and the motor's terminal quantities.
// =====================================================================

import type {
  ProjectFile,
  MotorParams,
  MotorStartingResult,
  BusDipResult,
} from "../types";
import { buildNetwork, effectiveStartingCurrentRatio } from "./network";
import { runLoadFlow } from "./loadFlow";

export function runMotorStarting(
  project: ProjectFile,
  startingMotorId: string,
): MotorStartingResult {
  // Locate the motor and confirm it is in the project.
  const motorComp = project.components.find(
    (c) => c.id === startingMotorId && c.type === "motor",
  );
  if (!motorComp) {
    throw new Error("Selected motor not found in project.");
  }
  const rawParams = motorComp.parameters as MotorParams;
  // Apply v0.3 → v0.4 fallbacks so legacy project files keep working.
  const mp: MotorParams = {
    ...rawParams,
    starting_method: rawParams.starting_method ?? "DOL",
    starting_pf: rawParams.starting_pf ?? 0.2,
  };

  // Pre-start network: all motors running normally.
  const preNet = buildNetwork(project);
  const pre = runLoadFlow(preNet);
  if (!pre.converged) {
    return failed(
      motorComp.id,
      motorComp.label,
      mp,
      `Pre-start load flow failed: ${pre.message ?? "did not converge"}`,
    );
  }

  // During-start network: chosen motor replaced by locked-rotor impedance shunt.
  const startNet = buildNetwork(project, { startingMotorId });
  const start = runLoadFlow(startNet);
  if (!start.converged) {
    return failed(
      motorComp.id,
      motorComp.label,
      mp,
      `During-start load flow failed: ${start.message ?? "did not converge"} ` +
        `— terminal voltage likely collapsed under inrush.`,
    );
  }

  // Locate the bus the motor sits on.
  const motorBusIdx = startNet.motors.find((m) => m.componentId === startingMotorId)?.busIndex;
  if (motorBusIdx === undefined) {
    throw new Error("Motor is not connected to a busbar.");
  }
  const motorBus = startNet.buses[motorBusIdx];

  // Motor reference quantities (at rated voltage).
  const electricalKw = mp.rated_kw / mp.efficiency;
  const electricalKva = electricalKw / mp.power_factor;
  const fullLoadCurrentA =
    motorBus.baseKv > 0 ? (electricalKva) / (Math.sqrt(3) * motorBus.baseKv) : 0;

  // Effective starting-current multiplier per chosen method.
  const factor = effectiveStartingCurrentRatio(mp.starting_method, mp.locked_rotor_current_ratio);

  // During-start terminal voltage from the second load flow.
  const termBus = start.buses[motorBusIdx];
  const Vpu = termBus.voltagePu;
  const VkV = termBus.voltageKv;

  // Starting current = V × |Y_start| (in pu).
  // S drawn at terminals = V² × S_start_rated (constant impedance scales with V²).
  // I in amps: scale by the bus's base current.
  const sStartRatedPu = factor * (electricalKva / 1000) / project.system.base_mva;
  const sActualPu = sStartRatedPu * Vpu * Vpu;
  const pActualPu = sActualPu * mp.starting_pf;
  const qActualPu = sActualPu * Math.sqrt(Math.max(0, 1 - mp.starting_pf * mp.starting_pf));

  const sActualKva = sActualPu * project.system.base_mva * 1000;
  const pActualKw = pActualPu * project.system.base_mva * 1000;
  const qActualKvar = qActualPu * project.system.base_mva * 1000;

  const startingCurrentA =
    VkV > 0 ? sActualKva / (Math.sqrt(3) * VkV) : 0;

  // Per-bus voltage dip table.
  const busDips: BusDipResult[] = pre.buses.map((pb, i) => {
    const sb = start.buses[i];
    const dip = pb.voltagePu > 0 ? ((pb.voltagePu - sb.voltagePu) / pb.voltagePu) * 100 : 0;
    return {
      busId: pb.busId,
      label: pb.label,
      nominalKv: pb.nominalKv,
      preStartVoltagePu: pb.voltagePu,
      duringStartVoltagePu: sb.voltagePu,
      duringStartVoltageKv: sb.voltageKv,
      dipPercent: dip,
    };
  });

  return {
    converged: true,
    iterations: start.iterations,
    motorId: motorComp.id,
    motorLabel: motorComp.label,
    motorBusId: motorBus.id,
    motorBusLabel: motorBus.label,
    startingMethod: mp.starting_method,
    effectiveStartingCurrentRatio: factor,
    fullLoadCurrentA,
    fullLoadKva: electricalKva,
    terminalVoltagePu: Vpu,
    terminalVoltageKv: VkV,
    startingCurrentA,
    startingKva: sActualKva,
    startingKw: pActualKw,
    startingKvar: qActualKvar,
    busDips,
    duringStartBranches: start.branches,
  };
}

function failed(
  motorId: string,
  motorLabel: string,
  mp: MotorParams,
  message: string,
): MotorStartingResult {
  return {
    converged: false,
    iterations: 0,
    message,
    motorId,
    motorLabel,
    motorBusId: "",
    motorBusLabel: "",
    startingMethod: mp.starting_method,
    effectiveStartingCurrentRatio: effectiveStartingCurrentRatio(
      mp.starting_method,
      mp.locked_rotor_current_ratio,
    ),
    fullLoadCurrentA: 0,
    fullLoadKva: 0,
    terminalVoltagePu: 0,
    terminalVoltageKv: 0,
    startingCurrentA: 0,
    startingKva: 0,
    startingKw: 0,
    startingKvar: 0,
    busDips: [],
    duringStartBranches: [],
  };
}
