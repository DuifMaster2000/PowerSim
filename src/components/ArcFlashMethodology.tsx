// =====================================================================
// Arc-flash methodology window. Opens from the arc-flash results and
// shows, step by step, how the IEEE 1584 answer was reached — the
// equations alongside the run's actual numbers. Reads ArcFlashResult and
// the ArcFlashDerivation the store attaches (numbers only), so the
// UI/solver layering rule is preserved.
// =====================================================================

import { useEffect } from "react";
import { useStore } from "../store";
import type { ArcFlashResult } from "../types";

const f = (n: number | undefined, d = 3): string =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(d) : "—";

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="method-section">
      <h3><span className="method-step">{n}</span>{title}</h3>
      {children}
    </section>
  );
}

function Eq({ children }: { children: React.ReactNode }) {
  return <div className="method-eq">{children}</div>;
}

function Body({ af }: { af: ArcFlashResult }) {
  const d = af.derivation;
  const is2018 = af.method.includes("2018");
  const ratio = d?.arcingRatio ?? (af.boltedKa > 0 ? af.arcingKa / af.boltedKa : 0);
  const lv = af.voltageKv < 1;

  return (
    <div className="method-body">
      <p className="method-intro">
        This report shows how Power Sim arrived at the arc-flash result for{" "}
        <strong>{af.busLabel}</strong> ({f(af.voltageKv, 2)} kV), following <strong>{af.method}</strong>.
        Incident energy is the heat a worker at the working distance would receive during the arc; it
        sets the PPE category. The chain is: bolted fault → arcing current → clearing time (from
        protection) → incident energy → boundary → PPE.
      </p>

      {af.outOfRange && (
        <div className="method-warn">
          ⚠ {f(af.voltageKv, 1)} kV is above {af.method}'s 15 kV validity limit — these numbers are an
          extrapolation. For HV the Lee method is the recommended model; treat this as indicative only.
        </div>
      )}

      <Section n={1} title="Equipment & geometry">
        <p>
          The conductor gap, working distance and {is2018 ? "electrode configuration / enclosure size" : "distance exponent"} are
          set by the equipment type and the bus voltage band (IEEE 1584 {is2018 ? "Tables 1–8" : "Table 4"}).
        </p>
        <table className="method-table">
          <tbody>
            <tr><td>Equipment</td><td>{af.equipmentClassLabel}</td></tr>
            {is2018
              ? <tr><td>Electrode configuration</td><td>{af.electrodeConfig}</td></tr>
              : <tr><td>System grounding</td><td>{af.grounded ? "grounded" : "ungrounded"}</td></tr>}
            <tr><td>Conductor gap G</td><td>{f(af.gapMm, 0)} mm</td></tr>
            <tr><td>Working distance D</td><td>{f(af.workingDistanceMm, 0)} mm</td></tr>
            {!is2018 && <tr><td>Distance exponent x</td><td>{f(d?.distanceExponent, 3)}</td></tr>}
            {is2018 && <tr><td>Enclosure-size correction CF</td><td>{f(d?.enclosureCorrection, 3)}</td></tr>}
          </tbody>
        </table>
      </Section>

      <Section n={2} title="Bolted fault current">
        <p>
          The starting point is the bolted three-phase fault current at the bus, from the IEC 60909
          short-circuit calculation (voltage factor c = {f(d?.scCFactor, 2)}).
        </p>
        <p className="method-worked">I_bf = <strong>{f(af.boltedKa, 2)} kA</strong></p>
      </Section>

      <Section n={3} title="Arcing current">
        <p>
          A real arc draws less than the bolted current. {is2018
            ? "The 2018 model evaluates the arcing current at the 600 / 2700 / 14300 V anchors and interpolates to the bus voltage (Clause 4, Eq 6 & 16–18)."
            : lv
              ? "Below 1 kV it depends on configuration and gap (IEEE 1584-2002 Eq 1)."
              : "At and above 1 kV it is independent of configuration and gap (IEEE 1584-2002 Eq 2)."}
        </p>
        {!is2018 && (lv
          ? <Eq>log₁₀(I_arc) = K + 0.662·log₁₀(I_bf) + 0.0966·V + 0.000526·G + 0.5588·V·log₁₀(I_bf) − 0.00304·G·log₁₀(I_bf)</Eq>
          : <Eq>log₁₀(I_arc) = 0.00402 + 0.983·log₁₀(I_bf)</Eq>)}
        <p className="method-worked">
          I_arc = <strong>{f(af.arcingKa, 2)} kA</strong>  (I_arc / I_bf = {f(ratio, 3)})
        </p>
      </Section>

      <Section n={4} title="Clearing time (from protection)">
        <p>
          The arc burns until a protective device clears it. Each relay's fault current is scaled from
          the bolted value by the arcing/bolted ratio and evaluated on its curve; the <em>fastest</em>{" "}
          device sets the time. Because the arcing current is lower than the bolted current, devices
          operate slower than at a bolted fault — a subtlety this captures.
        </p>
        <p className={`method-worked ${d?.assumedClearingTime ? "method-warntext" : ""}`}>
          t = <strong>{f(af.clearingTimeS, 3)} s</strong> — {af.clearingSource}
        </p>
        {d?.assumedClearingTime && (
          <p className="method-muted">No protective device cleared this bus, so an assumed 2.0 s was used — add protection for a real number.</p>
        )}
      </Section>

      <Section n={5} title="Incident energy at the working distance">
        {is2018 ? (
          <p>
            Energy is computed at the three voltage anchors and interpolated to the bus voltage (Eq 6 &
            19–21), including the enclosure-size correction CF = {f(d?.enclosureCorrection, 3)}. It
            scales linearly with the clearing time.
          </p>
        ) : (
          <>
            <p>Incident energy (IEEE 1584-2002 Eq 4/5), scaling linearly with clearing time:</p>
            <Eq>E[cal/cm²] = C_f · E_n · (t / 0.2) · (610 / D)^x</Eq>
            <p className="method-worked">
              = {f(d?.calcFactorCf, 2)} · {f(d?.normalizedEnergyJ, 3)} · ({f(af.clearingTimeS, 3)}/0.2) ·
              (610/{f(af.workingDistanceMm, 0)})^{f(d?.distanceExponent, 3)}
            </p>
          </>
        )}
        <p className="method-worked">E = <strong>{f(af.incidentEnergyCal, 2)} cal/cm²</strong> at {f(af.workingDistanceMm, 0)} mm</p>
      </Section>

      <Section n={6} title="Arc-flash boundary">
        <p>
          The distance at which the incident energy falls to 1.2 cal/cm² — the onset of a second-degree
          burn on bare skin.
        </p>
        <p className="method-worked">
          AFB = <strong>{f(af.arcFlashBoundaryMm, 0)} mm</strong> ({f(af.arcFlashBoundaryMm / 1000, 2)} m)
        </p>
      </Section>

      <Section n={7} title="PPE category (NFPA 70E)">
        <p>The incident energy maps to an arc-rated PPE category.</p>
        <p className="method-worked">
          {f(af.incidentEnergyCal, 2)} cal/cm² → <strong>{af.ppeLabel}</strong>
          {af.ppeCategory !== null ? ` (Category ${af.ppeCategory})` : ""}
        </p>
      </Section>

      <Section n={8} title="Assumptions & limitations">
        <ul className="method-list">
          <li>Bolted three-phase fault basis; the bolted current comes from the IEC 60909 study (its own simplifications apply).</li>
          <li>Clearing time is derived from <strong>relays only</strong> — fuse clearing times are not auto-derived; check fuse-protected equipment manually.</li>
          <li>Each relay's arcing current is scaled from the bolted bus current by the arcing/bolted ratio (radial approximation).</li>
          <li>Energy is reported for the <strong>selected bus only</strong>, at the configured working distance.</li>
          <li>IEEE 1584 is valid 0.208–15 kV; above 15 kV the result is an extrapolation (the Lee method is the correct HV tool).</li>
          <li>An educational engineering tool — real IEEE 1584 math, but not a substitute for a verified arc-flash study.</li>
        </ul>
      </Section>
    </div>
  );
}

export function ArcFlashMethodology() {
  const open = useStore((s) => s.arcFlashMethodologyOpen);
  const close = useStore((s) => s.closeArcFlashMethodology);
  const arcFlash = useStore((s) => s.arcFlash);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal methodology-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Arc-flash methodology">
        <div className="method-header">
          <h2>Arc-Flash Methodology · {arcFlash?.method ?? "IEEE 1584"}</h2>
          <div className="method-header-actions">
            <button onClick={() => window.print()} title="Print or save the methodology as a PDF">Print / PDF</button>
            <button className="glossary-close" onClick={close} aria-label="Close">×</button>
          </div>
        </div>
        {arcFlash ? (
          <Body af={arcFlash} />
        ) : (
          <div className="method-body">
            <p className="method-muted">
              Run an arc-flash study (select a busbar, then “Run Arc Flash”) to see its full methodology here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
