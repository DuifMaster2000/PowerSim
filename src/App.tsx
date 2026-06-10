// =====================================================================
// App: the top-level layout.
// =====================================================================

import { Toolbar } from "./components/Toolbar";
import { Palette } from "./components/Palette";
import { Canvas } from "./components/Canvas";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { ResultsPanel } from "./components/ResultsPanel";
import { GlossaryDrawer } from "./components/GlossaryDrawer";

export default function App() {
  return (
    <div className="app">
      <Toolbar />
      <Palette />
      <div style={{ position: "relative", gridArea: "canvas", overflow: "hidden" }}>
        <Canvas />
        <ResultsPanel />
      </div>
      <PropertiesPanel />
      <GlossaryDrawer />
    </div>
  );
}
