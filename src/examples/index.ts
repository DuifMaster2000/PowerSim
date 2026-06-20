// =====================================================================
// Bundled example networks. Each is a complete ProjectFile that loads
// straight into the store via loadProject. Pick one from the Examples
// menu in the Toolbar.
//
// All five use the voltage levels found on a real distribution system
// (132 / 33 / 11 / 6.6 / 0.525 kV) and include cables, breakers and CTs.
// =====================================================================

import type { ProjectFile } from "../types";
import { gridIntake132_33 } from "./01-grid-intake-132-33";
import { primarySubstation33_11 } from "./02-primary-substation-33-11";
import { motorFeeder66 } from "./03-motor-feeder-66";
import { ringMain33 } from "./04-ring-main-33";
import { fullPlant132_525 } from "./05-full-plant-132-525";

export interface ExampleEntry {
  id: string;
  name: string;
  description: string;
  file: ProjectFile;
}

export const EXAMPLES: ExampleEntry[] = [
  {
    id: "grid-intake-132-33",
    name: "Grid intake — 132/33 kV",
    description: "132 kV grid → incomer breaker (CT + relay) → 132/33 transformer → 33 kV feeder. Hello-world.",
    file: gridIntake132_33,
  },
  {
    id: "primary-substation-33-11",
    name: "Primary substation — 33/11 kV",
    description: "Graded protection: incomer relay + relay-protected and fuse-protected 11 kV feeders. Good for the grading study.",
    file: primarySubstation33_11,
  },
  {
    id: "motor-feeder-66",
    name: "MV motor feeder — 11/6.6 kV",
    description: "11/6.6 kV transformer feeding a 2.5 MW 6.6 kV motor with a GE-869 relay. For motor starting + motor protection.",
    file: motorFeeder66,
  },
  {
    id: "ring-main-33",
    name: "Ring main — 33 kV + embedded gen",
    description: "Closed 33 kV ring with an embedded generator (PV bus). Meshed — Newton-Raphson takes several iterations.",
    file: ringMain33,
  },
  {
    id: "full-plant-132-525",
    name: "Full plant — 132 kV to 525 V",
    description: "≈20 components spanning 132 / 33 / 11 / 6.6 / 0.525 kV — intake, motor board and LV board. Exercises every study.",
    file: fullPlant132_525,
  },
];
