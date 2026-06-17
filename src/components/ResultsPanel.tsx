// =====================================================================
// Results panel — bottom dock.
// Shows validation issues, load flow results, or short-circuit results
// depending on what was last run.
// =====================================================================

import { Fragment, type ReactNode } from "react";
import { useStore } from "../store";
import type { BusResult, BranchResult, LoadResult } from "../types";
import { AnimationPlayer } from "./AnimationPlayer";
import { GradingCurves } from "./GradingCurves";
import { Info } from "./Explain";

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((cell) => `"${cell}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Format kW with automatic unit scaling: kW below 1 MW, MW above.
function fmtP(kw: number) {
  return Math.abs(kw) >= 1000
    ? `${(kw / 1000).toFixed(3)} MW`
    : `${kw.toFixed(1)} kW`;
}
function fmtQ(kvar: number) {
  return Math.abs(kvar) >= 1000
    ? `${(kvar / 1000).toFixed(3)} Mvar`
    : `${kvar.toFixed(1)} kvar`;
}

function voltClass(pu: number) {
  if (pu < 0.9 || pu > 1.1) return "tag-bad";
  if (pu < 0.95 || pu > 1.05) return "tag-warn";
  return "tag-ok";
}
function loadClass(lp: number) {
  return lp > 100 ? "tag-bad" : lp > 80 ? "tag-warn" : "tag-ok";
}

// Section header row inside the shared table.
function SectionRow({ label, cols }: { label: string; cols: number }) {
  return (
    <tr>
      <td
        colSpan={cols}
        style={{
          paddingTop: 10,
          paddingBottom: 4,
          color: "var(--text-muted)",
          fontFamily: "var(--font-sans)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontWeight: 600,
          textAlign: "left",
          borderBottom: "1px solid var(--border-strong)",
        }}
      >
        {label}
      </td>
    </tr>
  );
}

// Sub-header row (column names) inside the shared table.
function SubHead({ cells }: { cells: string[] }) {
  return (
    <tr style={{ background: "var(--bg-elev)" }}>
      {cells.map((c, i) => (
        <th key={i} style={{ paddingTop: 4, paddingBottom: 4 }}>
          {c}
        </th>
      ))}
    </tr>
  );
}

// Voltage band thresholds for motor starting: tighter than steady-state because
// inrush is transient — the motor terminal must still reach pull-up torque
// (≈ 80% of rated voltage) and other loads should not dip below 90%.
function startVoltClass(pu: number) {
  if (pu < 0.85) return "tag-bad";
  if (pu < 0.95) return "tag-warn";
  return "tag-ok";
}
function dipClass(dip: number) {
  if (dip > 15) return "tag-bad";
  if (dip > 10) return "tag-warn";
  return "tag-ok";
}

export function ResultsPanel() {
  const resultsTab = useStore((s) => s.resultsTab);
  const setResultsTab = useStore((s) => s.setResultsTab);

  return (
    <div className={`results${resultsTab === "grading" ? " grading-active" : ""}`}>
      <div className="results-tabs">
        <button
          className={resultsTab === "results" ? "active" : ""}
          onClick={() => setResultsTab("results")}
        >
          Results
        </button>
        <button
          className={resultsTab === "grading" ? "active" : ""}
          onClick={() => setResultsTab("grading")}
        >
          Grading
        </button>
      </div>
      {resultsTab === "grading" ? <GradingCurves /> : <ResultsContent />}
    </div>
  );
}

function ResultsContent() {
  const runMode = useStore((s) => s.runMode);
  const loadFlow = useStore((s) => s.loadFlow);
  const shortCircuit = useStore((s) => s.shortCircuit);
  const openMethodology = useStore((s) => s.openMethodology);
  const motorStarting = useStore((s) => s.motorStarting);
  const arcFlash = useStore((s) => s.arcFlash);
  const validation = useStore((s) => s.validation);
  const explainMode = useStore((s) => s.explainMode);
  const baseMva = useStore((s) => s.baseMva);

  const errors = validation.filter((v) => v.level === "error");
  const warnings = validation.filter((v) => v.level === "warning");

  const exportLoadFlowCsv = () => {
    if (!loadFlow?.converged) return;

    const busById = new Map<string, BusResult>(loadFlow.buses.map((b) => [b.busId, b]));

    const rows: string[][] = [
      ["Section", "Label", "Side / Bus", "V [kV]", "V [%]", "Angle [°]", "I [A]", "Loading [%]", "P", "Q"],
    ];

    for (const b of loadFlow.buses) {
      rows.push(["Bus", b.label, "", b.voltageKv.toFixed(3), (b.voltagePu * 100).toFixed(2), b.angleDeg.toFixed(3), "", "", "", ""]);
    }

    const txBranches = loadFlow.branches.filter((b) => b.componentType === "transformer");
    for (const br of txBranches) {
      const fromBus = busById.get(br.fromBus);
      const toBus = busById.get(br.toBus);
      const fromBaseKv = fromBus ? fromBus.voltageKv / fromBus.voltagePu : 0;
      const toBaseKv = toBus ? toBus.voltageKv / toBus.voltagePu : 0;
      const iSec = toBaseKv > 0 ? br.currentA * (fromBaseKv / toBaseKv) : 0;
      rows.push(["Transformer", br.label, `Primary ${fromBaseKv.toFixed(2)} kV`, "", "", "", br.currentA.toFixed(1), br.loadingPercent.toFixed(1), fmtP(br.pMw * 1000), fmtQ(br.qMvar * 1000)]);
      rows.push(["Transformer", br.label, `Secondary ${toBaseKv.toFixed(3)} kV`, "", "", "", iSec.toFixed(1), "", fmtP(br.pMw * 1000), fmtQ(br.qMvar * 1000)]);
    }

    const otherBranches = loadFlow.branches.filter((b) => b.componentType !== "transformer");
    for (const br of otherBranches) {
      rows.push(["Branch", br.label, "", "", "", "", br.currentA.toFixed(1), br.loadingPercent.toFixed(1), fmtP(br.pMw * 1000), fmtQ(br.qMvar * 1000)]);
    }

    for (const ld of loadFlow.loads) {
      rows.push([ld.componentType === "motor" ? "Motor" : "Load", ld.label, ld.busId, "", "", "", ld.currentA.toFixed(1), "", fmtP(ld.pKw), fmtQ(ld.qKvar)]);
    }

    downloadCsv("loadflow-results.csv", rows);
  };

  const exportMotorStartingCsv = () => {
    if (!motorStarting?.converged) return;
    const m = motorStarting;
    const rows: string[][] = [
      ["Motor", m.motorLabel],
      ["Bus", m.motorBusLabel],
      ["Starting method", m.startingMethod],
      ["Effective starting current / FLC", m.effectiveStartingCurrentRatio.toFixed(2)],
      ["Full-load current [A]", m.fullLoadCurrentA.toFixed(1)],
      ["Full-load apparent [kVA]", m.fullLoadKva.toFixed(1)],
      [],
      ["Terminal voltage during start [pu]", m.terminalVoltagePu.toFixed(4)],
      ["Terminal voltage during start [kV]", m.terminalVoltageKv.toFixed(3)],
      ["Starting current [A]", m.startingCurrentA.toFixed(1)],
      ["Starting apparent [kVA]", m.startingKva.toFixed(1)],
      ["Starting active [kW]", m.startingKw.toFixed(1)],
      ["Starting reactive [kvar]", m.startingKvar.toFixed(1)],
      [],
      ["Bus", "Pre-start [pu]", "During-start [pu]", "During-start [kV]", "Dip [%]"],
      ...m.busDips.map((b) => [
        b.label,
        b.preStartVoltagePu.toFixed(4),
        b.duringStartVoltagePu.toFixed(4),
        b.duringStartVoltageKv.toFixed(3),
        b.dipPercent.toFixed(2),
      ]),
    ];
    downloadCsv("motor-starting-results.csv", rows);
  };

  const exportShortCircuitCsv = () => {
    if (!shortCircuit) return;
    const rows: string[][] = [
      ["Fault bus", shortCircuit.faultBusLabel],
      ["I_k_sym_kA", shortCircuit.ikSymKa.toFixed(3)],
      ["i_p_peak_kA", shortCircuit.ipPeakKa.toFixed(3)],
      [],
      ["Source", "Contribution_kA"],
      ...shortCircuit.contributions.map((c) => [c.label, c.currentKa.toFixed(3)]),
    ];
    downloadCsv("shortcircuit-results.csv", rows);
  };

  if (errors.length > 0) {
    return (
      <>
        <div className="results-header">
          <h3>Validation</h3>
          <div className="results-status">
            <span className="fail">{errors.length} ERROR{errors.length > 1 ? "S" : ""}</span>
            {warnings.length > 0 && <span>{warnings.length} WARN</span>}
          </div>
        </div>
        <div className="results-body">
          <div className="validation-list">
            {errors.map((e, i) => (
              <div className="validation-row error" key={`e${i}`}>
                <span className="tag">ERR</span>
                <span>{e.message}</span>
              </div>
            ))}
            {warnings.map((w, i) => (
              <div className="validation-row warning" key={`w${i}`}>
                <span className="tag">WARN</span>
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  if (runMode === "loadflow" && loadFlow) {
    const busById = new Map<string, BusResult>(
      loadFlow.buses.map((b) => [b.busId, b]),
    );

    const txBranches = loadFlow.branches.filter((b) => b.componentType === "transformer");
    const otherBranches = loadFlow.branches.filter((b) => b.componentType !== "transformer");

    // Compute secondary (to-bus) current for each transformer.
    const txSecondaryA = (br: BranchResult): number => {
      const fromBus = busById.get(br.fromBus);
      const toBus = busById.get(br.toBus);
      if (!fromBus || !toBus || toBus.voltagePu <= 0) return 0;
      const fromBaseKv = fromBus.voltageKv / fromBus.voltagePu;
      const toBaseKv = toBus.voltageKv / toBus.voltagePu;
      return toBaseKv > 0 ? br.currentA * (fromBaseKv / toBaseKv) : 0;
    };

    const totalLoadKw = loadFlow.loads.reduce((s, l) => s + l.pKw, 0);
    const totalLoadKvar = loadFlow.loads.reduce((s, l) => s + l.qKvar, 0);

    return (
      <>
        <div className="results-header">
          <h3>Load Flow Results</h3>
          <div className="results-status">
            {loadFlow.converged ? (
              <span className="ok">CONVERGED · {loadFlow.iterations} iter</span>
            ) : (
              <span className="fail">FAILED · {loadFlow.message ?? "did not converge"}</span>
            )}
            {warnings.length > 0 && (
              <span style={{ color: "var(--warn)" }}>{warnings.length} WARN</span>
            )}
            {loadFlow.converged && (
              <>
                <span style={{ color: "var(--text-dim)" }}>
                  Total load: {fmtP(totalLoadKw)} / {fmtQ(totalLoadKvar)}
                </span>
                <button
                  onClick={exportLoadFlowCsv}
                  style={{ fontSize: 11, padding: "1px 8px", marginLeft: 8 }}
                >
                  Export CSV
                </button>
              </>
            )}
          </div>
        </div>

        {loadFlow.converged && <AnimationPlayer />}
        {loadFlow.converged && (
          <div className="results-body">
            <table className="results-table">
              <tbody>
                {/* ── Buses ── */}
                <SectionRow label="Buses" cols={4} />
                <SubHead cells={["Bus", "V [kV]", "V [%]", "Angle [°]"]} />
                {loadFlow.buses.map((b) => {
                  const baseKv = b.voltagePu > 0 ? b.voltageKv / b.voltagePu : b.nominalKv;
                  return (
                    <tr key={b.busId}>
                      <td>
                        {b.label}
                        {explainMode && (
                          <span className="explain-hint">base {baseKv.toFixed(2)} kV</span>
                        )}
                      </td>
                      <td>
                        {b.voltageKv.toFixed(3)}
                        {explainMode && (
                          <span className="explain-hint">
                            = {b.voltagePu.toFixed(4)} × {baseKv.toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className={voltClass(b.voltagePu)}>{(b.voltagePu * 100).toFixed(2)}</td>
                      <td>{b.angleDeg.toFixed(2)}</td>
                    </tr>
                  );
                })}

                {/* ── Transformers ── */}
                {txBranches.length > 0 && (
                  <>
                    <SectionRow label="Transformers" cols={4} />
                    <SubHead cells={["Element · Side", "I [A]", "Loading [%]", "P / Q"]} />
                    {txBranches.map((br) => {
                      const fromBus = busById.get(br.fromBus);
                      const toBus = busById.get(br.toBus);
                      const fromBaseKv = fromBus
                        ? (fromBus.voltageKv / fromBus.voltagePu).toFixed(2)
                        : "?";
                      const toBaseKv = toBus
                        ? (toBus.voltageKv / toBus.voltagePu).toFixed(3)
                        : "?";
                      const iSec = txSecondaryA(br);
                      return (
                        <Fragment key={br.branchId}>
                          <tr key={`${br.branchId}-pri`}>
                            <td>
                              {br.label}
                              <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                                Primary {fromBaseKv} kV
                              </span>
                            </td>
                            <td>{br.currentA.toFixed(1)}</td>
                            <td className={loadClass(br.loadingPercent)}>
                              {br.loadingPercent.toFixed(1)}
                            </td>
                            <td>{fmtP(br.pMw * 1000)} / {fmtQ(br.qMvar * 1000)}</td>
                          </tr>
                          <tr key={`${br.branchId}-sec`} style={{ opacity: 0.85 }}>
                            <td>
                              <span style={{ color: "var(--text-muted)", marginLeft: 12 }}>
                                Secondary {toBaseKv} kV
                              </span>
                            </td>
                            <td>{iSec.toFixed(1)}</td>
                            <td style={{ color: "var(--text-muted)" }}>—</td>
                            <td>{fmtP(br.pMw * 1000)} / {fmtQ(br.qMvar * 1000)}</td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </>
                )}

                {/* ── Cables ── */}
                {otherBranches.length > 0 && (
                  <>
                    <SectionRow label="Cables" cols={4} />
                    <SubHead cells={["Branch", "I [A]", "Loading [%]", "P / Q"]} />
                    {otherBranches.map((br) => {
                      const sMva = Math.hypot(br.pMw, br.qMvar);
                      return (
                        <tr key={br.branchId}>
                          <td>{br.label}</td>
                          <td>{br.currentA.toFixed(1)}</td>
                          <td className={loadClass(br.loadingPercent)}>
                            {br.loadingPercent > 0 ? br.loadingPercent.toFixed(1) : "—"}
                          </td>
                          <td>
                            {fmtP(br.pMw * 1000)} / {fmtQ(br.qMvar * 1000)}
                            {explainMode && baseMva > 0 && (
                              <>
                                <span className="explain-hint">
                                  S_pu = {sMva.toFixed(3)}/{baseMva} = {(sMva / baseMva).toFixed(4)}
                                </span>
                                <Info topic="branch.s_pu" />
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </>
                )}

                {/* ── Loads & Motors ── */}
                {loadFlow.loads.length > 0 && (
                  <>
                    <SectionRow label="Loads &amp; Motors" cols={4} />
                    <SubHead cells={["Component", "Bus", "P / Q", "I [A]"]} />
                    {loadFlow.loads.map((ld) => (
                      <tr key={ld.loadId}>
                        <td>
                          {ld.label}
                          <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 10 }}>
                            {ld.componentType === "motor" ? "motor" : "load"}
                          </span>
                        </td>
                        <td style={{ color: "var(--text-dim)" }}>
                          {busById.get(ld.busId)?.label ?? ld.busId}
                        </td>
                        <td>{fmtP(ld.pKw)} / {fmtQ(ld.qKvar)}</td>
                        <td>{ld.currentA.toFixed(1)}</td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  if (runMode === "motorstart" && motorStarting) {
    const m = motorStarting;
    const currentMultiple = m.fullLoadCurrentA > 0
      ? m.startingCurrentA / m.fullLoadCurrentA
      : 0;

    return (
      <>
        <div className="results-header">
          <h3>Motor Starting Results</h3>
          <div className="results-status">
            {m.converged ? (
              <span className="ok">
                STARTING {m.motorLabel} @ {m.motorBusLabel} · {m.startingMethod}
              </span>
            ) : (
              <span className="fail">FAILED · {m.message ?? "did not converge"}</span>
            )}
            {m.converged && (
              <button
                onClick={exportMotorStartingCsv}
                style={{ fontSize: 11, padding: "1px 8px", marginLeft: 8 }}
              >
                Export CSV
              </button>
            )}
          </div>
        </div>

        {m.converged && (
          <div className="results-body">
            <table className="results-table">
              <tbody>
                {/* ── Motor terminal summary ── */}
                <SectionRow label="Motor at start" cols={4} />
                <SubHead cells={["Quantity", "Value", "Reference", "Note"]} />
                <tr>
                  <td>Terminal voltage</td>
                  <td className={startVoltClass(m.terminalVoltagePu)}>
                    {(m.terminalVoltagePu * 100).toFixed(1)} %
                  </td>
                  <td>{m.terminalVoltageKv.toFixed(3)} kV</td>
                  <td style={{ color: "var(--text-muted)" }}>
                    {m.terminalVoltagePu < 0.85
                      ? "below 85 % — motor may stall, insufficient torque"
                      : m.terminalVoltagePu < 0.95
                      ? "between 85 – 95 % — acceptable but reduced torque"
                      : "≥ 95 % — healthy start"}
                  </td>
                </tr>
                <tr>
                  <td>Starting current</td>
                  <td className="tag-warn">{m.startingCurrentA.toFixed(1)} A</td>
                  <td>{currentMultiple.toFixed(2)} × FLC</td>
                  <td style={{ color: "var(--text-muted)" }}>
                    FLC = {m.fullLoadCurrentA.toFixed(1)} A · effective LRC = {m.effectiveStartingCurrentRatio.toFixed(2)} × FLC at rated V
                  </td>
                </tr>
                <tr>
                  <td>Starting apparent</td>
                  <td>{m.startingKva.toFixed(1)} kVA</td>
                  <td>{m.fullLoadKva.toFixed(1)} kVA FLA</td>
                  <td style={{ color: "var(--text-muted)" }}>
                    {fmtP(m.startingKw)} / {fmtQ(m.startingKvar)}
                  </td>
                </tr>

                {/* ── Bus voltage dips ── */}
                <SectionRow label="Bus voltage dips" cols={4} />
                <SubHead cells={["Bus", "Pre-start [%]", "During start [%]", "Dip [%]"]} />
                {m.busDips.map((b) => (
                  <tr key={b.busId}>
                    <td>
                      {b.label}
                      {b.busId === m.motorBusId && (
                        <span style={{ color: "var(--accent)", marginLeft: 6, fontSize: 10 }}>
                          motor terminal
                        </span>
                      )}
                    </td>
                    <td>{(b.preStartVoltagePu * 100).toFixed(2)}</td>
                    <td className={startVoltClass(b.duringStartVoltagePu)}>
                      {(b.duringStartVoltagePu * 100).toFixed(2)}
                    </td>
                    <td className={dipClass(b.dipPercent)}>
                      {b.dipPercent.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  if (runMode === "shortcircuit" && shortCircuit) {
    return (
      <>
        <div className="results-header">
          <h3>Short-Circuit Results · IEC 60909 (3-phase)</h3>
          <div className="results-status">
            <span className="ok">FAULT AT {shortCircuit.faultBusLabel}</span>
            <button
              onClick={openMethodology}
              style={{ fontSize: 11, padding: "1px 8px", marginLeft: 8 }}
              title="Show the full IEC 60909 methodology — every step from impedances to the fault current"
            >
              Methodology
            </button>
            <button
              onClick={exportShortCircuitCsv}
              style={{ fontSize: 11, padding: "1px 8px", marginLeft: 8 }}
            >
              Export CSV
            </button>
          </div>
        </div>
        <div className="results-body">
          <table className="results-table">
            <thead>
              <tr>
                <th>Quantity</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>I_k" — initial symmetrical short-circuit current</td>
                <td className="tag-bad">{shortCircuit.ikSymKa.toFixed(3)} kA</td>
              </tr>
              <tr>
                <td>i_p — peak short-circuit current</td>
                <td className="tag-bad">{shortCircuit.ipPeakKa.toFixed(3)} kA</td>
              </tr>
              <tr>
                <td colSpan={2} style={{ paddingTop: 8, color: "var(--text-muted)", textAlign: "left" }}>
                  Contributions
                </td>
              </tr>
              {shortCircuit.contributions.map((c) => (
                <tr key={c.sourceId}>
                  <td>{c.label}</td>
                  <td>{c.currentKa.toFixed(3)} kA</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  if (runMode === "arcflash" && arcFlash) {
    const af = arcFlash;
    const toneClass = af.ppeLabel.startsWith("Below") ? "tag-ok" : af.incidentEnergyCal > 8 ? "tag-bad" : "tag-warn";
    const exportArcFlashCsv = () => {
      downloadCsv("arcflash-results.csv", [
        ["Quantity", "Value"],
        ["Method", af.method],
        ["Bus", af.busLabel],
        ["Voltage [kV]", af.voltageKv.toFixed(3)],
        ["Equipment", af.equipmentClassLabel],
        ["Electrode config", af.electrodeConfig ?? "n/a (2002)"],
        ["Gap [mm]", String(af.gapMm)],
        ["Working distance [mm]", String(af.workingDistanceMm)],
        ["Bolted fault [kA]", af.boltedKa.toFixed(2)],
        ["Arcing current [kA]", af.arcingKa.toFixed(2)],
        ["Clearing time [s]", af.clearingTimeS.toFixed(3)],
        ["Clearing device", af.clearingSource],
        ["Incident energy [cal/cm2]", af.incidentEnergyCal.toFixed(2)],
        ["Arc-flash boundary [mm]", af.arcFlashBoundaryMm.toFixed(0)],
        ["PPE", af.ppeLabel],
      ]);
    };
    const row = (label: string, value: ReactNode, cls?: string) => (
      <tr><td>{label}</td><td className={cls}>{value}</td></tr>
    );
    return (
      <>
        <div className="results-header">
          <h3>Arc Flash · {af.method}</h3>
          <div className="results-status">
            <span className="ok">{af.busLabel} · {af.voltageKv.toFixed(2)} kV</span>
            <button onClick={exportArcFlashCsv} style={{ fontSize: 11, padding: "1px 8px", marginLeft: 8 }}>
              Export CSV
            </button>
          </div>
        </div>
        <div className="results-body">
          {af.outOfRange && (
            <div style={{ background: "var(--warn-bg, rgba(251,191,36,0.12))", border: "1px solid var(--warn)", color: "var(--warn)", borderRadius: 6, padding: "8px 12px", marginBottom: 10, fontSize: 12, lineHeight: 1.5 }}>
              ⚠ {af.voltageKv.toFixed(1)} kV is <strong>above {af.method}'s 15 kV validity limit</strong> — these numbers are an extrapolation. For HV (e.g. 33 kV / 132 kV) the Lee method is the recommended model; treat this result as indicative only.
            </div>
          )}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div className={`af-badge ${toneClass}`}>
              <div className="af-cal">{af.incidentEnergyCal.toFixed(1)}<span> cal/cm²</span></div>
              <div className="af-ppe">{af.ppeLabel}</div>
            </div>
            <table className="results-table" style={{ flex: 1, minWidth: 320 }}>
              <thead><tr><th>Quantity</th><th>Value</th></tr></thead>
              <tbody>
                {row("Equipment", af.equipmentClassLabel)}
                {af.electrodeConfig
                  ? row("Electrode config", af.electrodeConfig)
                  : row("Grounding", af.grounded ? "grounded" : "ungrounded")}
                {row("Bolted fault current", `${af.boltedKa.toFixed(2)} kA`)}
                {row("Arcing current", `${af.arcingKa.toFixed(2)} kA`)}
                {row("Clearing time", `${af.clearingTimeS.toFixed(3)} s`, af.clearingSource.startsWith("assumed") ? "tag-warn" : undefined)}
                {row("Cleared by", af.clearingSource)}
                {row("Incident energy @ " + af.workingDistanceMm + " mm", `${af.incidentEnergyCal.toFixed(2)} cal/cm²`, toneClass)}
                {row("Arc-flash boundary", `${af.arcFlashBoundaryMm.toFixed(0)} mm (${(af.arcFlashBoundaryMm / 1000).toFixed(2)} m)`)}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 8 }}>
            Incident energy is highly sensitive to clearing time — it scales linearly with it. The arcing
            current is below the bolted current, so the protective device may operate slower than at a bolted
            fault. {af.clearingSource.startsWith("assumed") && "No relay was found to clear this bus, so an assumed 2.0 s was used — set up protection for a real number."}
          </p>
        </div>
      </>
    );
  }

  return null;
}
