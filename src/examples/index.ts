// =====================================================================
// Bundled example networks. Each is a complete ProjectFile that loads
// straight into the store via loadProject. Drag-drop the Examples
// menu in the Toolbar to pick one.
// =====================================================================

import type { ProjectFile } from "../types";
import { radial2Bus } from "./01-radial-2bus";
import { threeBusPv } from "./02-three-bus-pv";
import { motorStartMv } from "./03-motor-start-mv";
import { meshLoop } from "./04-mesh-loop";
import { industrialPlant } from "./05-industrial-plant";

export interface ExampleEntry {
  id: string;
  name: string;
  description: string;
  file: ProjectFile;
}

export const EXAMPLES: ExampleEntry[] = [
  {
    id: "radial-2bus",
    name: "Radial — 2 bus",
    description: "Grid → 11 kV bus → transformer → 0.4 kV bus → load. Hello-world.",
    file: radial2Bus,
  },
  {
    id: "three-bus-pv",
    name: "Three-bus PV",
    description: "Two grid sources — second acts as a PV bus with scheduled MW.",
    file: threeBusPv,
  },
  {
    id: "motor-start-mv",
    name: "Motor starting (MV)",
    description: "11 kV grid, transformer to LV, DOL motor for inrush analysis.",
    file: motorStartMv,
  },
  {
    id: "mesh-loop",
    name: "Mesh loop (3 cables)",
    description: "Ring topology — Newton-Raphson takes 4–5 iters. Good for animation.",
    file: meshLoop,
  },
  {
    id: "industrial-plant",
    name: "Industrial plant",
    description: "≈15 components — incomer, MV bus, two outgoing feeders.",
    file: industrialPlant,
  },
];
