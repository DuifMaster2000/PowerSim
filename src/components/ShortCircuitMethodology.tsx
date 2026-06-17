// =====================================================================
// Short-circuit methodology window. Opens from the short-circuit results
// and shows, step by step, how the IEC 60909 answer was reached — the
// equations alongside the worked numbers from the actual run. Reads the
// derivation the solver attaches to ShortCircuitResult (numbers only), so
// the UI/solver layering rule is preserved.
// =====================================================================

import { useEffect } from "react";
import { useStore } from "../store";
import type { ShortCircuitDerivation } from "../types";

const f = (n: number, d = 3): string =>
  Number.isFinite(n) ? n.toFixed(d) : "—";

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="method-section">
      <h3>
        <span className="method-step">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Eq({ children }: { children: React.ReactNode }) {
  return <div className="method-eq">{children}</div>;
}

function Body({ d }: { d: ShortCircuitDerivation }) {
  const hasTx = d.transformers.length > 0;
  return (
    <div className="method-body">
      <p className="method-intro">
        This report shows how Power Sim arrived at the short-circuit result for a fault at{" "}
        <strong>{d.faultBusLabel}</strong>, following <strong>{d.standard}</strong>. The method
        replaces the running network with a single equivalent voltage source{" "}
        <em>c·Uₙ/√3</em> at the fault point, reduces every impedance to a Thévenin equivalent seen
        from the fault bus, and divides to get the current. Pre-fault load currents are neglected.
        The voltage factor in use is <strong>c = {f(d.cFactor, 2)}</strong>.
      </p>

      <Section n={1} title="Per-unit base">
        <p>
          All impedances are normalised to the system base, then currents are converted back to amps
          at the fault-bus voltage.
        </p>
        <Eq>I_base = S_base / (√3 · Uₙ)</Eq>
        <p className="method-worked">
          = {f(d.baseMva, 0)} MVA / (√3 · {f(d.baseKv, 3)} kV) = <strong>{f(d.baseCurrentA, 1)} A</strong>
        </p>
      </Section>

      <Section n={2} title="Source impedance">
        <p>
          Each grid source is an impedance behind the equivalent voltage source, derived from its
          short-circuit level and X/R ratio.
        </p>
        <Eq>Z_src = S_base / S″_k  ;  X = Z·(X/R)/√(1+(X/R)²)  ;  R = Z/√(1+(X/R)²)</Eq>
        <table className="method-table">
          <thead>
            <tr><th>Source</th><th>S″_k (MVA)</th><th>X/R</th><th>R (pu)</th><th>X (pu)</th><th>|Z| (pu)</th><th>Contribution</th></tr>
          </thead>
          <tbody>
            {d.sources.map((s, i) => (
              <tr key={i}>
                <td>{s.label}</td>
                <td>{f(s.shortCircuitMva, 0)}</td>
                <td>{f(s.xrRatio, 1)}</td>
                <td>{f(s.rPu, 4)}</td>
                <td>{f(s.xPu, 4)}</td>
                <td>{f(s.zMagPu, 4)}</td>
                <td>{f(s.contributionKa, 3)} kA</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section n={3} title="Transformer impedance & IEC 60909 correction (K_T)">
        {hasTx ? (
          <>
            <p>
              A transformer's impedance comes from its rated impedance voltage on its own rating.
              IEC 60909 then applies a correction factor <em>K_T</em> for the short-circuit
              calculation — <strong>the load-flow study keeps the uncorrected impedance.</strong>
            </p>
            <Eq>Z_T = (u_k% / 100) · (S_base / S_rT)   →   Z_T,corrected = K_T · Z_T</Eq>
            <Eq>K_T = 0.95 · c / (1 + 0.6 · x_T)   (x_T = reactance on the transformer's own rating)</Eq>
            <table className="method-table">
              <thead>
                <tr><th>Transformer</th><th>S_rT (MVA)</th><th>x_T (pu)</th><th>K_T @ c={f(d.cFactor, 2)}</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {d.transformers.map((t, i) => (
                  <tr key={i}>
                    <td>{t.label}</td>
                    <td>{f(t.ratedMva, 2)}</td>
                    <td>{f(t.xTpu, 4)}</td>
                    <td>{f(t.ktFactor, 4)}</td>
                    <td>{t.ktFactor < 1 ? "raises fault level" : t.ktFactor > 1 ? "lowers fault level" : "neutral"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="method-muted">This network has no transformers, so the K_T correction does not apply.</p>
        )}
      </Section>

      <Section n={4} title="Network reduction (Y-bus → Z-bus)">
        <p>
          The branch admittances (transformers carrying K_T, plus each source's admittance at its
          bus) are assembled into the bus admittance matrix <em>Y</em>, which is inverted to
          <em> Z = Y⁻¹</em>. The Thévenin impedance seen from the fault bus is its diagonal entry
          <em> Z_kk</em>.
        </p>
        <p className="method-worked">
          Z_kk = {f(d.zThevRePu, 4)} {d.zThevImPu >= 0 ? "+" : "−"} j{f(Math.abs(d.zThevImPu), 4)} pu
          {"  →  "}|Z_kk| = <strong>{f(d.zThevMagPu, 4)} pu</strong>, X/R = {f(d.xrAtFault, 2)}
        </p>
      </Section>

      <Section n={5} title="Initial symmetrical short-circuit current I″k">
        <Eq>I″k = c · Uₙ / (√3 · Z_kk) = (c / |Z_kk|) · I_base</Eq>
        <p className="method-worked">
          = {f(d.cFactor, 2)} / {f(d.zThevMagPu, 4)} = {f(d.ikPu, 4)} pu
          {"  →  "}× {f(d.baseCurrentA, 1)} A = <strong>{f(d.ikSymKa, 3)} kA</strong>
        </p>
      </Section>

      <Section n={6} title="Peak short-circuit current i_p">
        <Eq>κ = 1.02 + 0.98 · e^(−3 / (X/R))   ;   i_p = κ · √2 · I″k</Eq>
        <p className="method-worked">
          κ = {f(d.kappa, 3)}{"  →  "}i_p = {f(d.kappa, 3)} · √2 · {f(d.ikSymKa, 3)} ={" "}
          <strong>{f(d.ipPeakKa, 3)} kA</strong>
        </p>
      </Section>

      <Section n={7} title="Assumptions & limitations">
        <ul className="method-list">
          <li>Bolted <strong>three-phase symmetrical</strong> fault only — line-to-ground / line-to-line faults are not modelled.</li>
          <li>Equivalent voltage source c·Uₙ/√3; pre-fault load flow and load currents are neglected (per IEC 60909).</li>
          <li>Transformer correction K_T is applied; <strong>generator / power-station corrections (Kg, Ks) are not.</strong></li>
          <li>Motors contribute as a fixed subtransient impedance at their bus.</li>
          <li>Per-source / per-branch contribution split is exact for radial networks and an approximation for meshed ones.</li>
          <li>An educational engineering tool — the solver is real IEC 60909 math, but this is not a substitute for a verified compliance study.</li>
        </ul>
      </Section>
    </div>
  );
}

export function ShortCircuitMethodology() {
  const open = useStore((s) => s.methodologyOpen);
  const close = useStore((s) => s.closeMethodology);
  const shortCircuit = useStore((s) => s.shortCircuit);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;
  const d = shortCircuit?.derivation;

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal methodology-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Short-circuit methodology">
        <div className="method-header">
          <h2>Short-Circuit Methodology · IEC 60909</h2>
          <div className="method-header-actions">
            <button onClick={() => window.print()} title="Print or save the methodology as a PDF">Print / PDF</button>
            <button className="glossary-close" onClick={close} aria-label="Close">×</button>
          </div>
        </div>
        {d ? (
          <Body d={d} />
        ) : (
          <div className="method-body">
            <p className="method-muted">
              Run a short-circuit study (select a busbar, then “Run Short Circuit”) to see its full
              methodology here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
