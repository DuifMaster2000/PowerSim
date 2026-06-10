// =====================================================================
// Glossary drawer. Slide-out right panel with reference content:
// per-unit system, bus types, Newton-Raphson, branch impedance, symbols.
// Always available — independent of the Explain-mode toggle.
// =====================================================================

import { useEffect } from "react";
import { useStore } from "../store";
import { GLOSSARY_SECTIONS } from "../explainContent";

export function GlossaryDrawer() {
  const open = useStore((s) => s.glossaryOpen);
  const setOpen = useStore((s) => s.setGlossaryOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <>
      <div className="glossary-backdrop" onClick={() => setOpen(false)} />
      <aside className="glossary-drawer" role="dialog" aria-label="Glossary">
        <div className="glossary-header">
          <h2>Glossary &amp; formulas</h2>
          <button className="glossary-close" onClick={() => setOpen(false)} aria-label="Close glossary">
            ×
          </button>
        </div>
        <div className="glossary-body">
          {GLOSSARY_SECTIONS.map((s) => (
            <section className="glossary-section" key={s.id}>
              <h3>{s.title}</h3>
              {s.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              {s.formula && <div className="glossary-formula">{s.formula}</div>}
            </section>
          ))}
        </div>
      </aside>
    </>
  );
}
