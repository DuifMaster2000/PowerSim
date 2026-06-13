# Power Sim — CLAUDE.md

Project context for Claude Code. Read this before starting any work.

---

## What this is

**Power Sim** is a browser-based power systems simulator built with React 18 + TypeScript + Vite. Users drag components onto a canvas to build single-line diagrams, then run steady-state load flow (Newton-Raphson), IEC 60909 three-phase short-circuit analysis, and motor-starting voltage-dip studies. Results appear on the canvas and in a bottom results panel.

This is a learning/engineering tool — not a compliance-grade product, but the solver is real power systems math.

**Owner:** Marlou (beginner programmer, learning as we go — keep explanations clear)

---

## How to run

```
npm install        # only needed once, or after package.json changes
npm run dev        # starts Vite on http://localhost:5000
```

Type-check without building: `npx tsc --noEmit`

---

## Architecture (three clean layers — keep them decoupled)

```
src/
  types.ts           All data shapes (component params, solver results, project file)
  defaults.ts        Default parameter values + component metadata
  store.ts           Zustand store — project state, actions, undo/redo, run dispatch
  validation.ts      Pre-solve checks (errors block run, warnings allow it)
  solver/
    math.ts          Complex numbers, Gaussian elimination, matrix inversion
    network.ts       Project → solver-ready NetworkModel (buses, branches, sources)
    loadFlow.ts      Newton-Raphson load flow (slack + PQ + PV buses)
    shortCircuit.ts  IEC 60909 simplified 3-phase fault
    motorStart.ts    Motor-starting study (pre + during-start load flow, per-bus dip)
  components/
    Canvas.tsx       React Flow canvas, drag-drop, connection drawing
    Toolbar.tsx      File actions, undo/redo, run buttons, c-factor toggle
    Palette.tsx      Left sidebar — draggable component library
    PropertiesPanel.tsx  Right sidebar — selected component parameter editor
    ResultsPanel.tsx     Bottom dock — validation issues / results tables / CSV export
    nodes.tsx        React Flow node renderers (one per component type)
    symbols.tsx      SVG electrical symbols (IEC style)
  App.tsx, main.tsx, styles.css
```

**Rule:** `solver/` imports nothing from React. UI imports nothing from `solver/` except through the store dispatch.

---

## Component types

`grid_source` | `busbar` | `transformer` | `cable` | `load` | `motor` | `switch` | `fuse` | `relay` | `ct`

---

## Version history

### v0.1 (original zip)
- Single-slack-bus Newton-Raphson load flow
- IEC 60909 3-phase short circuit (c=1.1 hardcoded, no Kt/Kg)
- Basic canvas with React Flow, properties panel, results table
- Save/load `.psim.json`, undo/redo

### v0.2 (committed: `5bca6d9`)
**Solver:**
- Multi-source load flow — additional grid sources become PV buses (fixed V, scheduled P injection via `GridSourceParams.scheduled_mw`). Full PV-bus Jacobian blocks added to N-R.
- IEC 60909 voltage factor `c` is now user-selectable (1.05 / 1.10) via toggle in Toolbar. `runShortCircuit(net, faultIdx, cFactor)` signature.
- Transformer loading % now computed in branch results (`BranchModel.ratedMva`).
- N-R divergence protection: V bounds [0.5, 2.0] pu with clear error message.

**UX:**
- Undo debounce: edits on same component within 300 ms share one history snapshot.
- Inline parameter validation in PropertiesPanel: red border + error for out-of-range values. `min`/`max` added to `FieldDef`.
- Unsaved-changes flag (`isDirty`): Save button shows `*`, New/close prompt confirmation.
- Export CSV button in ResultsPanel for load flow and short-circuit results.

**Housekeeping:**
- Removed Replit files (`.replit`, `replit.nix`) and duplicate `unzipped_program/` tree.
- Fixed pre-existing wrong import in `symbols.tsx` (`./types` → `../types`).

### v0.3 — UI/visual cleanup for large networks

**Selection clarity:**
- Stronger `.node.selected` highlight (2px accent ring + glow + tinted gradient).
- Edges connected to the selected component get a `touching-selected` class so wiring is easy to trace.

**Extendable busbars (true SLD look):**
- `BusbarParams` gains `length_px` (default 200). Bus renders at that width via inline `style.width` on the React Flow node.
- `NodeResizer` on busbars: drag the right edge to extend (horizontal-only via `shouldResize` returning false on N/S handles). Resize persists through `updateComponentParams` (history-aware via the existing 300 ms debounce).
- New custom edge `BusbarEdge` (`src/components/busbarEdge.tsx`): when one end is a busbar, snaps that end's X to the connected component's center X, clamped to the bar's bounds. Produces straight perpendicular drop lines. Registered as `edgeTypes.busbar` and assigned when either endpoint is a busbar.
- Old `.psim.json` files without `length_px` fall back to 200 via `?? 200`.

**Visual load flow results on canvas:**
- Solver: `LoadFlowResult.loads: LoadResult[]` — per-load/motor current (`I = S / (√3·V)`) computed from final bus voltages. `LoadModel` added to `NetworkModel`; `MotorModel` augmented with `electricalKw`/`electricalKvar`.
- Edge labels show current (A) by default, or "A · kW · loading%" in detailed mode. Toggle in Toolbar (`Labels: A only` / `A + kW`), state in `edgeReadoutMode`.
- Flow direction arrowheads on edges: loads/motors always point to consumer, branches use `pMw` sign + `fromBus/toBus` mapping.
- Edge stroke colored by loading tone (live cyan / warn amber / bad red).

**Backlog extras pulled in:**
- Pan/zoom persistence: `viewport` lives in the store and is written to the project file (`ProjectFile.viewport`). `onMoveEnd` persists; `projectLoadKey` bumps on every new/loaded project to trigger a refit (or restore to saved viewport).
- Zoom-to-fit on project load: `useReactFlow().fitView({ padding: 0.2 })` runs in an effect keyed on `projectLoadKey` when no viewport was saved.
- Inline label editing: double-click a node's label → input with autofocus + select. Enter / blur commits via `updateComponentLabel`; Escape cancels. Input uses `nodrag` class so React Flow doesn't intercept.
- Right-click context menu: `onNodeContextMenu` opens a small floating menu (canvas-area-local coords) with Duplicate + Delete. New store action `duplicateComponent(id)` clones params + label and offsets position by (24, 24). Connections are not duplicated.

### v0.4 — Motor starting analysis + flexible topology

**Flexible topology (terminal-level union-find):**
- Previously, every cable/switch had to land bus-to-bus and terminals (load/motor/source) had to attach directly to a busbar. This forced an awkward `bus → CB → bus → motor` even when the physical reality is `bus → CB → motor` or `bus → CB → cable → motor`.
- New model in `solver/network.ts`: two component **terminals** are in the same electrical bus iff connected via any chain of wires + closed switches + shared busbars. Cables and transformers separate buses.
- Implementation is a **union-find** on terminal keys (`"componentId:terminalId"`). Within-component unions: busbar top↔bottom, closed-switch in↔out. Connection unions: from↔to. Each equivalence class becomes one BusModel.
- If a class contains a real busbar, that busbar's label / nominal kV define the bus. Otherwise the bus is **synthetic** — auto-labelled after the components on it (e.g. `M-01 node`).
- Switches are now **absorbed** into bus classes (the old 1e-6 Ω pseudo-branch is gone). They no longer appear in `branches[]` or in the Results panel.
- Orphan buses (not reachable from the slack bus through branches — happens when a CB is opened to isolate a section) are filtered out before solving, with bus/branch/source/motor/load indices re-mapped, so the rest of the network solves cleanly instead of producing a singular Jacobian.
- Validation relaxed: switches and cables can connect to bus / switch / cable / load / motor / grid_source. Transformers stay strict bus-to-bus.

**Synthetic bus dots on the canvas:**
- Each synthetic bus is rendered as a small cyan dot at the centroid of the wires that make up its electrical class (the connections between member components). Label below the dot shows the auto-generated bus name (e.g. `M-01 node`).
- Clickable — selects the synthetic bus as the short-circuit fault target (mirrors the busbar-click pattern). Goes red when selected as fault.
- After a load flow, the dot also shows the bus voltage as a readout, tone-coded like the existing busbar readouts.
- Wired through the store via `getSyntheticBuses()` so the UI layer doesn't import from `solver/` (preserves the existing layering rule).
- React Flow node type `syntheticBus`, rendered by `SyntheticBusNode` in `nodes.tsx`. Non-draggable, non-deletable; `onNodesChange` skips any id starting with `node-`.



**Motor starting study — when a motor starts, can it develop torque, and how much do other buses dip?**

**Method:**
- Run **two** load flows back-to-back and diff them.
  - *Pre-start*: all motors running in normal PQ mode (standard load flow).
  - *During-start*: the chosen motor is replaced with its locked-rotor impedance modelled as a **constant shunt admittance** on its bus. S drawn scales with V², which is the physically correct behaviour for a stalled rotor.
- New solver `src/solver/motorStart.ts` — `runMotorStarting(project, motorId) → MotorStartingResult`.

**Network model changes (`solver/network.ts`):**
- `BusModel.shuntYPu: Complex` — added by `buildYBus` to the bus's Y-matrix diagonal.
- `buildNetwork(project, { startingMotorId? })` — when set, the chosen motor's PQ injection is skipped and its locked-rotor admittance goes into `shuntYPu` instead. All other motors stay in normal PQ mode.
- New helper `effectiveStartingCurrentRatio(method, lockedRotorRatio)` returns the multiplier of FLC for the chosen method:
  - DOL → full LRC
  - Star-delta → LRC / 3
  - Soft-starter → min(LRC, 3.5)
  - VFD → min(LRC, 1.1)

**Motor parameter additions (`MotorParams`):**
- `starting_method: "DOL" | "star-delta" | "soft-starter" | "VFD"` (default DOL)
- `starting_pf: number` — locked-rotor power factor, default 0.2 (very inductive)
- Legacy v0.3 motors without these fields keep working: both `network.ts` and `motorStart.ts` apply `?? "DOL"` / `?? 0.2` fallbacks.

**Store / UX wiring:**
- `startingMotorId: string | null` — mirrors the `faultBusId` pattern. Auto-set when a motor is clicked on the canvas (alongside selection).
- `runMotorStarting()` action; new `RunMode` value `"motorstart"`.
- `motorStarting: MotorStartingResult | null` — cleared whenever the network mutates (same pattern as `loadFlow` / `shortCircuit`).

**UI:**
- **Toolbar**: new "Run Motor Start" button (disabled until a motor is selected). A chip next to it shows the picked motor label. Version chip bumped to v0.4.
- **PropertiesPanel**: motor section gains `starting_method` (select) + `starting_pf` (number) fields.
- **ResultsPanel**: new render branch for `motorstart` mode showing two tables:
  1. *Motor at start* — terminal voltage (tone-coded), starting current (A + multiple of FLC), starting kVA/kW/kvar, with an inline note explaining the terminal-voltage outcome.
  2. *Bus voltage dips* — every bus's pre-start vs during-start pu and the % dip, with the motor's own bus tagged "motor terminal".
  - Voltage tone: `< 0.85 = bad`, `< 0.95 = warn`. Dip tone: `> 15 % = bad`, `> 10 % = warn`. Typical motor-starting study thresholds.
- CSV export for motor-starting results follows the same pattern as the other two study types.

### v0.7 — Protection coordination (overcurrent 51)

Adds a basic protection layer on top of the existing power model. The power solver is **untouched** — protection is a live view computed from relay parameters + the last short-circuit result.

**New components:** `relay` (IDMT overcurrent, "51") and `ct` (current transformer).

**Control-wire model (the key design decision):**
- Relays and CTs are normal placeable canvas nodes, but the wires linking them carry **no power**. A connection is a *control wire* iff either endpoint is a relay or CT (`isControlConnection` in `store.ts`).
- The chain modelled is `conductor —(CT clamps on)— CT →(control wire)→ relay →(control wire)→ breaker`.
- **CT clamps onto a conductor (drop-on-wire):** a CT is *not* wired into the power circuit. Instead `CtParams.on_connection_id` stores the power connection it measures. Dragging a CT from the palette onto the canvas snaps it to the nearest power conductor within ~70px (`Canvas.tsx` onDrop: nearest by `distToSegment`), and it renders **inline at that connection's midpoint**, locked (non-draggable). The CT's only wire is the single dashed control wire out to its relay. `removeConnection` unbinds any CT clamped to a deleted conductor (falls back to a free draggable node); a CT with a null/dangling `on_connection_id` renders at its stored position and raises a warning.
- Control wires are **excluded from the power topology**: `network.ts` skips any union-find connection touching a relay/CT, and `validation.ts` skips the branch-neighbour check for them. So relays/CTs are invisible to load flow / short circuit. Old `.psim.json` files load unchanged (purely additive).
- `relay`/`ct` have `TERMINAL_COUNT = 0` and `IS_BRANCH = false` — an unwired relay/CT never blocks a run. Protection-specific issues surface only as **warnings** (no CT, no breaker, CT not clamped onto a conductor, CT with no relay).
- Relay → CT/breaker links are resolved **live** from connections (`resolveRelayLinks` / `getRelayLinks`), not cached in params.

**IDMT math — `src/idmt.ts` (pure, top-level, not under `solver/`):**
- Lives at `src/idmt.ts` (not `solver/`) so both the UI (`GradingCurves`) and any solver code can import it without breaking the "UI imports nothing from solver/" rule.
- IEC 60255-151: `t = TMS·K / ((I/Is)^α − 1)`. Constants: SI(0.14, 0.02), VI(13.5, 1.0), EI(80, 2.0), LTI(120, 1.0), plus Definite Time. Pickup `Is = plug_setting × CT primary` (fallback 100 A primary with a warning when no CT).
- `idmtCurvePoints` / `idmtOperateTime` / `fuseTccPoints` (approximate gG/aM melting band — clearly **not** manufacturer data, educational overlay only).

**Store:** `resultsTab: "results" | "grading"` + `setResultsTab`. `getRelayFaultCurrents()` maps each relay → the fault current through its breaker (radial heuristic: breaker's bus → incident `branchFlows` side current, ×1000 A; falls back to fault-bus `ikSymKa`).

**UI:**
- **Palette / symbols / nodes**: relay + CT added; IEC SVG symbols (relay = "I>" circle, CT = toroid on a line); both wired with control handles only.
- **Canvas**: control wires render **dashed + muted**, never the busbar edge type, no flow label.
- **PropertiesPanel**: relay fields (curve select with friendly `CURVE_LABELS`, plug setting, TMS, definite-time shown only for DT); CT fields (primary A, 1/5 A secondary). Relay has a read-only **Protection links** section (resolved CT + breaker); CT has a read-only **Measured conductor** section showing the clamped conductor (warn-coloured when unbound).
- **ResultsPanel**: now has a **Results / Grading** tab bar (`resultsTab`). The existing body became `ResultsContent`; the new `GradingCurves.tsx` renders a hand-built **log–log TCC chart** (one coloured curve per relay, dashed band per fuse, decade gridlines), **fault-current markers** + operate-time dots from `getRelayFaultCurrents()`, and a **grading-margin table** (Δt < 0.3 s = bad, < 0.4 s = warn). CSV export of curve data + margins.

### v0.8 — CT becomes a wire property (not a draggable component)

The v0.7 CT was a placeable node that "clamped" onto a conductor via `CtParams.on_connection_id`, which left the toroid sitting awkwardly on the wire. v0.8 makes a **current transformer a property of the power connection itself**.

**Model:**
- `Connection.ct?: CtParams | null` — a wire carries a CT iff this is set. `CtParams` is now just `{ primary_a, secondary_a }` (the `on_connection_id` back-reference is gone). The `ct` value of `ComponentType` is **removed** entirely — CTs are no longer components.
- Relays reference their CT by connection id: `RelayParams.measured_connection_id`. Picked from a **dropdown** of CT-equipped wires in the relay's properties panel. The relay still trips its breaker over a dashed **control wire** (unchanged), so `resolveRelayLinks` now resolves the CT from `measured_connection_id` and the breaker from the control wire. `RelayLinks.ctId` → `ctConnectionId`.
- The relay node dropped its `ct_in` terminal — it has only a `trip` source now.

**Store:** new `setConnectionCt(connId, ct | null)` action (clears any relay's `measured_connection_id` when a CT is removed). `removeConnection` likewise detaches relays pointing at the deleted wire. `isControlConnection` is now relay-only.

**UI:**
- **Palette**: CT item removed.
- **PropertiesPanel**: selecting a *power* wire shows a "Current transformer" section (None / Fitted + primary/secondary). The relay's "Protection links" section gained the **Measured CT** dropdown.
- **Canvas / busbarEdge**: a wire with a CT renders a clickable **toroid badge** (`CtGlyph` + rating) at its midpoint via the custom edge; clicking it selects the wire. The custom edge is now used whenever a wire involves a busbar **or** carries a CT.

**Back-compat:** `migrateLegacyCts` in `store.ts` runs on `loadProject` — it copies each legacy CT component's rating onto the conductor it clamped, repoints any relay that was control-wired to it via `measured_connection_id`, then drops the CT components and their control wires. Old `.psim.json` files load unchanged.

### v0.9 — Sectional grading studies (selectable TCC curves)

The grading tab previously plotted every relay + fuse, always. v0.9 makes the study **selection-driven** so a specific section can be graded.

**Selection model:**
- `gradingSelection: string[]` in the store (view-only: not in the project file or undo history; cleared on new/load; pruned in `removeComponent`). Actions: `toggleGradingComponent(id)`, `clearGradingSelection()`.
- **With the Grading tab open, clicking a grading-capable component on the canvas toggles it in/out of the study** (`GRADABLE_TYPES` in `defaults.ts`: relay, switch, fuse, motor, cable, transformer). Clicking a breaker's symbol in grading mode does NOT operate it (`onSymbolClick` checks `resultsTab`).
- Selected components show a **colored dot** (`.node-grading-dot`) whose colour matches their curve in the chart — `GRADING_COLORS` in `defaults.ts` is shared by Canvas and GradingCurves, keyed by selection order. The Grading tab shows removable **chips** per selection + Clear all.
- Empty selection = previous behaviour (all relays + fuses).

**New curves (all in `src/idmt.ts`, pure):**
- **Motor start curve** — `motorStartCurvePoints(flcA, startA, startTimeS)`: locked-rotor current until the run-up time, then FLC. New `MotorParams.starting_time_s` (default 5 s, legacy `?? 5`). FLC needs the motor's bus kV → store getter `getMotorGradingData()` (uses `buildNetwork` + `effectiveStartingCurrentRatio`, preserving the UI/solver layering rule).
- **Cable thermal damage** — `cableDamageCurvePoints(csaMm2, …)`: adiabatic I²t with k = 143 (Cu/XLPE, `CABLE_K_CU_XLPE`). New `CableParams.csa_mm2` (default 120 mm², legacy `?? 120`).
- **Transformer damage + inrush** — `transformerDamageCurvePoints(inA)`: IEC 60076-5 / ANSI C57.109 category I (t = 1250/m², 3.5–25×In, In at primary kV) plus `transformerInrushPoint(inA)` (12×In @ 0.1 s) drawn as a ring marker.
- A selected **breaker resolves to the relay(s) that trip it** (via `getRelayLinks().breakerId`); breakers with no relay produce a warning note under the chart, as do unwired motors.
- A selected **busbar** draws a vertical **fault-level line** (Ik″) in the bus's colour, plus a fault-level table. Computed per selected bus via `getBusFaultLevels()` (`buildNetwork` + `runShortCircuit` at the current c-factor), independent of any short-circuit run. Only real busbars are gradable (synthetic buses aren't components).
- Curve kinds are dash-coded (relay solid, fuse/motor/cable/transformer distinct dashes). Fault markers + grading-margin table cover only the *displayed* relays.
- Axis caveat: curves are plotted at **each device's own voltage level** (axis label says so); currents are not referred across transformers.

### v0.10 — Relay hardware models (ABB REM615)

Relays now carry a **hardware model** that constrains their settings to what the real device accepts.

- `RelayParams.relay_model: "generic" | "ABB-REM615"` (default `"generic"`, legacy `?? "generic"`). Spec table `RELAY_MODELS` in `defaults.ts`: per-model plug-setting / TMS / definite-time ranges + available curve set.
  - **generic**: classic electromechanical-era ranges — plug 0.1–5 ×In, TMS 0.025–1.5, DT 0.01–100 s, IEC curves only.
  - **ABB-REM615** (Relion 615 series, PHLPTOC low stage): plug 0.05–5.00 ×In, **TMS 0.05–15.0**, DT 0.04–200 s, IEC curves + **ABB RI inverse**.
- New `IdmtCurve` value `"ABB-RI"`: t = k / (0.339 − 0.236/m) in `idmt.ts` — flattens toward ~2.95·k at high multiples (grades against old ABB disc relays). Excluded from `IEC_CONSTANTS` typing.
- **PropertiesPanel**: "Relay type" select; `applyRelayModel` rewrites the curve options and numeric min/max per model. Switching model **clamps** out-of-range settings and resets unavailable curves to IEC-SI; relay numeric inputs re-seed via React key on model change. Validation message now states the actual minimum (`Must be ≥ x`).

**Multi-stage overcurrent (REM615):**
- `RelayModelSpec.stages: 1 | 3`. The REM615 models all three Relion phase stages as flat `RelayParams` fields: stage 1 = existing `curve`/`plug_setting`/`time_multiplier`/`definite_time_s` (3I>, PHLPTOC); `stage2_*` = 3I>> high stage (PHHPTOC, 0.10–40 ×In, IDMT or DT); `stage3_*` = 3I>>> instantaneous (PHIPTOC, 1–40 ×In, DT only, ≥0.02 s). All have legacy `??` fallbacks (disabled by default).
- `idmtOperateTime` returns **min over enabled stages** (a real relay trips on the fastest stage); `idmtCurvePoints` samples extra point pairs straddling each enabled pickup so the composite renders crisp vertical steps. `relayHighestPickupA` extends the chart's current axis to cover the instantaneous step.
- PropertiesPanel: stage fields show only on multi-stage models (`relayFieldVisible`); per-stage timing fields follow the stage's curve type (TMS for IDMT, time for DT — applied to stage 1 too). Stage enables render Enabled/Disabled. Switching to a 1-stage model **force-disables stages 2/3** so hidden stages can't shape the curve.
- Grading legend tags multi-stage relays (e.g. `RLY-01 · 3-stage Standard Inverse`).

### v0.11 — Inline transformers (no busbar required at the terminals)

Transformers now follow the **same flexible-neighbour rule** as switches / fuses / cables (`isValidBranchNeighbour` in `validation.ts` dropped the transformer special-case; `"transformer"` was added to `FLEXIBLE_NEIGHBOUR_ALLOWED`). A breaker, fuse or cable can sit directly at a transformer's terminals without an explicit busbar drawn in between — common on real SLDs.

This is **validation-only**; the network builder already handled it. Closed switches are absorbed into the adjacent bus (so a transformer reached through breakers lands on the real bus on each side), and where a bus is genuinely needed (e.g. transformer → cable, or transformer → motor with nothing else on that side) a **synthetic bus** is created and base-kV is propagated through the transformer ratio onto it. Verified: `SRC → BB → breaker → TX → breaker → motor` solves with the secondary as a synthetic 0.4 kV bus.

### v0.12 — Reference-voltage referral on the grading chart

Curves across a transformer are at different voltages, so their currents aren't directly comparable on one axis. v0.12 adds a **"Refer to:" dropdown** in the Grading header that refers every curve to one common voltage.

- `gradingRefKv: number | null` in the store (view-only; null = each device's own level; reset on new/load). Action `setGradingRefKv`.
- New store getter `getComponentKv()` → `Map<componentId, kV>`: bus members get their bus base-kV; transformers/cables get their from-bus (primary) base-kV. Uses `buildNetwork`, preserving the UI/solver layering rule.
- Referral is a horizontal shift on the log-current axis: `I_plot = I_actual × (kV_device / refKv)` (power-conserving across the ratio). In `GradingCurves`, each curve/marker/bus-line carries a `factor`; the actual-amp points stay intact and the factor is applied only at plot time (and curves are sampled to `iMax / factor` so the referred curve still reaches the axis edge). A relay's voltage is its **breaker's** bus kV (fallback: the CT conductor's bus).
- **Tables stay in actual amps** (physically honest); only the chart is referred. A caption + CSV header note state the reference. Devices whose kV can't be resolved are plotted unreferred with a warning note.
- Dropdown options are the distinct voltage levels present in the network; axis label updates to "referred to X kV".

### v0.13 — Thermal overload element (49) on the REM615

Adds the motor thermal-overload protection function, completing the motor-protection coordination picture (start curve ↓ thermal ↓ damage limits).

- `RelayParams` gains `thermal_enabled` / `thermal_tau_min` (τ, minutes) / `thermal_k` (continuous-overload factor); multi-stage models only, disabled by default, legacy `??` fallbacks. Switching to a 1-stage model force-disables it (alongside stages 2/3).
- `thermalCurvePoints(relay, ct, …)` in `idmt.ts` (pure): IEC 60255-149 thermal replica, cold start (θ_prev = 0) → `t = τ·ln(I² / (I² − (k·Ib)²))`. Base current `Ib` = `thermal_base_a` when > 0, else the CT primary rating (`thermal_base_a = 0` is "auto", the default; the CT is sized to motor FLC). Asymptotes to ∞ at `k·Ib`, falls steeply at high current.
- `FieldDef.hint` renders a small muted note under a field (used for the "0 = auto (CT primary)" base-current hint).
- Plotted as a **separate** curve (own dash `6 2 1 2`, label `· thermal 49 (τNm)`) in the relay's colour — not folded into the overcurrent composite or the fault-current operate-time markers (thermal is an overload, not a fault, function). Referral-aware via the curve `factor`.
- PropertiesPanel: thermal section under the stages on multi-stage models; τ/k shown only when enabled. Verified the curve sits above a 6×FLC / 8 s motor start (28 s trip at locked rotor) while still protecting sustained overloads.

---

## Known limitations / v0.5 candidates

These are the documented gaps, roughly prioritised:

| # | Area | What's missing | Notes |
|---|------|----------------|-------|
| 1 | Solver | IEC 60909 **Kt correction factor** for transformers | K_T = c / (1 + 0.6·x_T) approx; results ~5–10% optimistic without it |
| 2 | Solver | **Relative pivot tolerance** in `math.ts` Gaussian elim (line ~81) | Currently absolute `1e-14`; should scale to max element × 1e-10 |
| 3 | Solver | **Q limits** on PV buses | PV buses currently inject unlimited Q; real sources have reactive limits |
| 4 | Results | **Voltage band customisation** | Hard-coded 0.9/0.95/1.05/1.1 pu thresholds |
| 5 | Results | **Comparison mode** | Run, tweak, re-run — keep previous results alongside new ones |
| 6 | Export | **Export diagram as SVG/PNG** | Canvas screenshot |
| 7 | Symbols | **More IEC symbols** | Generator (distinct from grid source), capacitor bank, harmonic filter |
| 8 | Architecture | **Unit tests for solver** | `solver/` is React-free — easy to add Vitest tests; none exist yet |
| 9 | UI | **Duplicate with connections** | Current `duplicateComponent` clones the component only; could optionally clone its incident wires |
| 10 | Motor start | **Acceleration time / torque-speed curve** | v0.4 models the worst-instant inrush only; no run-up integration or motor-vs-load torque modelling |
| 11 | Motor start | **Simultaneous starting of multiple motors** | One motor at a time; group-start studies need manual scenario runs |

---

## Key conventions

- **No comments** except for non-obvious WHY (hidden constraint, workaround, subtle invariant).
- **No mock data or feature flags** — change the code directly.
- **TypeScript strict mode** is on. Run `npx tsc --noEmit` to verify before committing.
- **Solver layer stays pure** — no React, no store imports inside `src/solver/`.
- Git identity: name=Marlou, email=pietersemarlou@gmail.com

---

## Project file format

`.psim.json` — version `"1.0"`. Shape defined by `ProjectFile` in `src/types.ts`.
