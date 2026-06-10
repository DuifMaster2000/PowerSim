# Power Sim — v0.1

A browser-based power systems simulator for building single-line diagrams and running steady-state load flow and IEC 60909 short-circuit analysis.

This is a first-cut implementation of the v1 spec — fully functional but expect rough edges.

## Setup

Requires Node.js 18 or later.

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`) in a browser.

For a production build: `npm run build`, then `npm run preview`.

## Quick start

1. Drag a **Grid Source** onto the canvas from the left palette.
2. Drag a **Busbar** below it and connect the source's bottom terminal to the busbar's top.
3. Drag a **Transformer**, connect its primary to the first bus.
4. Drag a second **Busbar** and connect to the transformer's secondary.
5. Drag a **Load** or **Motor** and connect it to the second bus.
6. Set each component's parameters in the right-hand panel (defaults are reasonable).
7. Click **Run Load Flow** — voltages and currents appear on the canvas, full results in the bottom table.
8. Click a busbar to mark it as the fault point, then **Run Short Circuit** for IEC 60909 results.
9. **Save** writes the project to a `.psim.json` file; **Open** loads one.

Tip: switches/breakers toggle by clicking their symbol. Re-run after toggling to see the effect.

## Architecture

- `src/types.ts` — all data shapes
- `src/defaults.ts` — default parameters and component metadata
- `src/store.ts` — Zustand store: project state, actions, run dispatch
- `src/validation.ts` — pre-solve checks
- `src/solver/math.ts` — complex numbers and linear algebra
- `src/solver/network.ts` — build the solver-ready network from the project
- `src/solver/loadFlow.ts` — Newton-Raphson load flow
- `src/solver/shortCircuit.ts` — IEC 60909 simplified three-phase fault
- `src/components/` — React UI (Toolbar, Palette, Canvas, PropertiesPanel, ResultsPanel, nodes, symbols)

The three layers (UI / model / solver) are deliberately decoupled — the solver imports nothing from React and can be tested in isolation.

## Known limitations (v0.1)

These are the documented simplifications from the v1 spec:

- IEC 60909 **impedance correction factors** (Kt for transformers, Kg for generators) are **not applied**. Results are within a few percent of full IEC for typical networks.
- Three-phase **balanced** symmetrical fault only. Single-line-to-ground, line-to-line, and double-line-to-ground faults need sequence networks — out of scope here.
- Single grid source (slack bus) only. Multiple sources / distributed generators not yet supported.
- Source contributions in short-circuit results use a simplified superposition that's accurate for radial topology; meshed networks may show small inaccuracies.
- No tap-changer logic, no three-winding transformers, no harmonics, no transient analysis.
- Cable loading uses ampacity directly; transformer loading-percent is not yet displayed on the canvas readout (it appears in the results table only).
- No undo/redo, no equipment template library, no dark/light theme toggle, no mobile/touch optimisation.

## Test network

Try this small network to verify everything works:

| Component | Parameters |
|---|---|
| Grid source | 11 kV, 500 MVA SC, X/R 10 |
| Busbar BB-01 | 11 kV |
| Transformer | 1 MVA, 11/0.4 kV, 5%, X/R 10 |
| Busbar BB-02 | 0.4 kV |
| Cable | 0.124 + j0.08 Ω/km, 50 m, 400 A |
| Busbar BB-03 | 0.4 kV |
| Motor | 75 kW, pf 0.85, η 0.92, LRC 6 |
| Load | 100 kW + 33 kvar |

Expected: load flow converges in <10 iterations; LV busbar voltage around 0.97–0.99 pu; short circuit at BB-02 around 25–30 kA.
