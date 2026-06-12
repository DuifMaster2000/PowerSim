// =====================================================================
// Top toolbar: project name, file actions, run actions.
// =====================================================================

import { useRef, useEffect, useState } from "react";
import { useStore } from "../store";
import type { ProjectFile } from "../types";
import { EXAMPLES } from "../examples";

export function Toolbar() {
  const projectName = useStore((s) => s.projectName);
  const setProjectName = useStore((s) => s.setProjectName);
  const newProject = useStore((s) => s.newProject);
  const loadProject = useStore((s) => s.loadProject);
  const exportProject = useStore((s) => s.exportProject);
  const runLoadFlow = useStore((s) => s.runLoadFlow);
  const runShortCircuit = useStore((s) => s.runShortCircuit);
  const runMotorStarting = useStore((s) => s.runMotorStarting);
  const clearResults = useStore((s) => s.clearResults);
  const faultBusId = useStore((s) => s.faultBusId);
  const startingMotorId = useStore((s) => s.startingMotorId);
  const components = useStore((s) => s.components);
  const startingMotorLabel = components.find((c) => c.id === startingMotorId)?.label;
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const isDirty = useStore((s) => s.isDirty);
  const markSaved = useStore((s) => s.markSaved);
  const shortCircuitCFactor = useStore((s) => s.shortCircuitCFactor);
  const setShortCircuitCFactor = useStore((s) => s.setShortCircuitCFactor);
  const edgeReadoutMode = useStore((s) => s.edgeReadoutMode);
  const setEdgeReadoutMode = useStore((s) => s.setEdgeReadoutMode);
  const explainMode = useStore((s) => s.explainMode);
  const setExplainMode = useStore((s) => s.setExplainMode);
  const glossaryOpen = useStore((s) => s.glossaryOpen);
  const setGlossaryOpen = useStore((s) => s.setGlossaryOpen);

  const fileInput = useRef<HTMLInputElement>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl) {
        if (e.key === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
          e.preventDefault();
          redo();
        }
        return;
      }
      // Plain "?" toggles Explain mode — but only when no text input has focus,
      // so typing "?" in the project-name or a properties field still works.
      if (e.key === "?") {
        const tag = (document.activeElement?.tagName ?? "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        e.preventDefault();
        setExplainMode(!explainMode);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, explainMode, setExplainMode]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const onSave = () => {
    const data = exportProject();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName || "project"}.psim.json`;
    a.click();
    URL.revokeObjectURL(url);
    markSaved();
  };

  const onOpen = () => fileInput.current?.click();
  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = JSON.parse(text) as ProjectFile;
      if (parsed.version !== "1.0") throw new Error("Unsupported file version");
      loadProject(parsed);
    } catch (err) {
      alert(`Could not open project: ${err instanceof Error ? err.message : String(err)}`);
    }
    e.target.value = "";
  };

  const onNew = () => {
    if (!isDirty || confirm("You have unsaved changes. Discard and start a new project?")) {
      newProject();
    }
  };

  const onPickExample = (file: ProjectFile) => {
    setExamplesOpen(false);
    if (!isDirty || confirm("You have unsaved changes. Discard and load this example?")) {
      // Clone deep enough that edits to the loaded project don't mutate our bundled copy.
      loadProject(JSON.parse(JSON.stringify(file)) as ProjectFile);
    }
  };

  return (
    <header className="toolbar">
      <div className="brand">
        POWER<span style={{ color: "var(--text)" }}>·SIM</span>
        <span className="brand-version"> v0.9</span>
      </div>
      <button
        className={explainMode ? "pill on" : "pill"}
        onClick={() => setExplainMode(!explainMode)}
        title="Toggle Explain mode — adds info icons and tooltips throughout the UI (shortcut: ?)"
      >
        Explain: {explainMode ? "on" : "off"}
      </button>
      <button
        className={glossaryOpen ? "pill on" : "pill"}
        onClick={() => setGlossaryOpen(!glossaryOpen)}
        title="Open the glossary drawer (formulas, bus types, per-unit, symbol legend)"
      >
        Glossary
      </button>
      <div className="divider" />
      <button onClick={onNew}>New</button>
      <button onClick={onOpen}>Open</button>
      <div style={{ position: "relative" }}>
        <button onClick={() => setExamplesOpen((v) => !v)} title="Load a bundled example network">
          Examples ▾
        </button>
        {examplesOpen && (
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 49 }}
              onClick={() => setExamplesOpen(false)}
            />
            <div className="examples-menu">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.id}
                  className="examples-item"
                  onClick={() => onPickExample(ex.file)}
                >
                  <span className="examples-name">{ex.name}</span>
                  <span className="examples-desc">{ex.description}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <button onClick={onSave} title={isDirty ? "Unsaved changes" : "Project saved"}>
        Save{isDirty ? " *" : ""}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,.psim.json,application/json"
        style={{ display: "none" }}
        onChange={onFileChosen}
      />
      <div className="divider" />
      <button
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        style={{ opacity: canUndo ? 1 : 0.35 }}
      >
        Undo
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
        style={{ opacity: canRedo ? 1 : 0.35 }}
      >
        Redo
      </button>
      <div className="divider" />
      <button className="primary" onClick={runLoadFlow}>
        Run Load Flow
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          className="primary"
          onClick={runShortCircuit}
          disabled={!faultBusId}
          title={!faultBusId ? "Click a busbar first to select the fault location" : ""}
        >
          Run Short Circuit
        </button>
        <button
          title="IEC 60909 voltage factor c: 1.10 = maximum fault current, 1.05 = minimum"
          style={{
            fontSize: "11px",
            padding: "2px 6px",
            background: "var(--panel-bg)",
            border: "1px solid var(--border)",
            color: "var(--accent)",
            cursor: "pointer",
            borderRadius: 3,
          }}
          onClick={() => setShortCircuitCFactor(shortCircuitCFactor === 1.10 ? 1.05 : 1.10)}
        >
          c={shortCircuitCFactor.toFixed(2)}
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          className="primary"
          onClick={runMotorStarting}
          disabled={!startingMotorId}
          title={
            startingMotorId
              ? `Run motor-starting analysis for ${startingMotorLabel}`
              : "Click a motor first to select it as the starting motor"
          }
        >
          Run Motor Start
        </button>
        {startingMotorLabel && (
          <span
            title="Starting motor"
            style={{
              fontSize: "11px",
              padding: "2px 6px",
              background: "var(--panel-bg)",
              border: "1px solid var(--border)",
              color: "var(--accent)",
              borderRadius: 3,
            }}
          >
            {startingMotorLabel}
          </span>
        )}
      </div>
      <button onClick={clearResults}>Clear</button>
      <button
        title="Toggle the level of detail on edge labels after a load flow run"
        onClick={() => setEdgeReadoutMode(edgeReadoutMode === "minimal" ? "detailed" : "minimal")}
        style={{ fontSize: "11px" }}
      >
        Labels: {edgeReadoutMode === "minimal" ? "A only" : "A + kW"}
      </button>
      <div className="spacer" />
      <input
        className="project-name"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
      />
    </header>
  );
}
