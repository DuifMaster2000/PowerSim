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
  const runArcFlash = useStore((s) => s.runArcFlash);
  const arcFlashMethod = useStore((s) => s.arcFlashMethod);
  const setArcFlashMethod = useStore((s) => s.setArcFlashMethod);
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
  const [fileMenuOpen, setFileMenuOpen] = useState(false);

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
    setFileMenuOpen(false);
    if (!isDirty || confirm("You have unsaved changes. Discard and start a new project?")) {
      newProject();
    }
  };

  const onPickExample = (file: ProjectFile) => {
    setExamplesOpen(false);
    setFileMenuOpen(false);
    if (!isDirty || confirm("You have unsaved changes. Discard and load this example?")) {
      // Clone deep enough that edits to the loaded project don't mutate our bundled copy.
      loadProject(JSON.parse(JSON.stringify(file)) as ProjectFile);
    }
  };

  const onFileOpen = () => {
    setFileMenuOpen(false);
    onOpen();
  };

  const onFileSave = () => {
    setFileMenuOpen(false);
    onSave();
  };

  const onFileUndo = () => {
    setFileMenuOpen(false);
    undo();
  };

  const onFileRedo = () => {
    setFileMenuOpen(false);
    redo();
  };

  return (
    <header className="toolbar">
      <div className="brand">
        POWER<span style={{ color: "var(--text)" }}>·SIM</span>
        <span className="brand-version"> v0.18</span>
      </div>
      <div className="toolbar-menu-wrap">
        <button
          className={fileMenuOpen ? "toolbar-menu-button active" : "toolbar-menu-button"}
          onClick={() => {
            setFileMenuOpen((v) => !v);
            setExamplesOpen(false);
          }}
          title="Project file actions"
        >
          File ▾
        </button>
        {fileMenuOpen && (
          <>
            <div
              className="toolbar-menu-backdrop"
              onClick={() => {
                setFileMenuOpen(false);
                setExamplesOpen(false);
              }}
            />
            <div className="toolbar-menu">
              <button className="toolbar-menu-item" onClick={onNew}>
                <span>New project</span>
                <kbd>new</kbd>
              </button>
              <button className="toolbar-menu-item" onClick={onFileOpen}>
                <span>Open…</span>
                <kbd>.psim</kbd>
              </button>
              <div className="toolbar-menu-section">
                <button
                  className={examplesOpen ? "toolbar-menu-item active" : "toolbar-menu-item"}
                  onClick={() => setExamplesOpen((v) => !v)}
                  title="Load a bundled example network"
                >
                  <span>Examples</span>
                  <kbd>›</kbd>
                </button>
                {examplesOpen && (
                  <div className="examples-menu compact">
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
                )}
              </div>
              <div className="toolbar-menu-divider" />
              <button className="toolbar-menu-item" onClick={onFileSave}>
                <span>Save project</span>
                <kbd>{isDirty ? "unsaved" : "saved"}</kbd>
              </button>
              <div className="toolbar-menu-divider" />
              <button className="toolbar-menu-item" onClick={onFileUndo} disabled={!canUndo}>
                <span>Undo</span>
                <kbd>Ctrl+Z</kbd>
              </button>
              <button className="toolbar-menu-item" onClick={onFileRedo} disabled={!canRedo}>
                <span>Redo</span>
                <kbd>Ctrl+Y</kbd>
              </button>
            </div>
          </>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".json,.psim.json,application/json"
        style={{ display: "none" }}
        onChange={onFileChosen}
      />
      <div className="divider" />
      <div className="toolbar-study-group" aria-label="Analysis studies">
        <button className="primary" onClick={runLoadFlow}>
          Load Flow
        </button>
        <button
          className="primary"
          onClick={runShortCircuit}
          disabled={!faultBusId}
          title={!faultBusId ? "Click a busbar first to select the fault location" : ""}
        >
          Short Circuit
        </button>
        <button
          title="IEC 60909 voltage factor c: 1.10 = maximum fault current, 1.05 = minimum"
          className="toolbar-chip"
          onClick={() => setShortCircuitCFactor(shortCircuitCFactor === 1.10 ? 1.05 : 1.10)}
        >
          c={shortCircuitCFactor.toFixed(2)}
        </button>
        <button
          className="primary"
          onClick={runArcFlash}
          disabled={!faultBusId}
          title={!faultBusId ? "Click a busbar first to select the location" : "IEEE 1584 incident energy at the selected bus"}
        >
          Arc Flash
        </button>
        <button
          title="Arc-flash standard edition: 2018 (electrode configs, enclosure correction) or 2002"
          className="toolbar-chip"
          onClick={() => setArcFlashMethod(arcFlashMethod === "1584-2018" ? "1584-2002" : "1584-2018")}
        >
          {arcFlashMethod}
        </button>
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
          Motor Start
        </button>
        {startingMotorLabel && (
          <span
            title="Starting motor"
            className="toolbar-chip"
          >
            {startingMotorLabel}
          </span>
        )}
      </div>
      <div className="divider" />
      <div className="toolbar-tools">
        <button
          className={explainMode ? "pill on" : "pill"}
          onClick={() => setExplainMode(!explainMode)}
          title="Toggle Explain mode — adds info icons and tooltips throughout the UI (shortcut: ?)"
        >
          Explain
        </button>
        <button
          className={glossaryOpen ? "pill on" : "pill"}
          onClick={() => setGlossaryOpen(!glossaryOpen)}
          title="Open the glossary drawer (formulas, bus types, per-unit, symbol legend)"
        >
          Glossary
        </button>
        <button
          className="pill"
          title="Toggle the level of detail on edge labels after a load flow run"
          onClick={() => setEdgeReadoutMode(edgeReadoutMode === "minimal" ? "detailed" : "minimal")}
        >
          Labels: {edgeReadoutMode === "minimal" ? "A" : "A+kW"}
        </button>
        <button className="pill" onClick={clearResults}>Clear</button>
      </div>
      <div className="spacer" />
      {isDirty && <span className="dirty-dot" title="Unsaved changes" />}
      <input
        className="project-name"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
      />
    </header>
  );
}
