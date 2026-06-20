import { describe, test, expect } from "vitest";
import { EXAMPLES } from "./examples";
import { validateProject } from "./validation";
import type { CtParams } from "./types";

describe("bundled examples", () => {
  test("there are five, each with a unique id", () => {
    expect(EXAMPLES).toHaveLength(5);
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(5);
  });

  for (const ex of EXAMPLES) {
    describe(ex.id, () => {
      test("validates with no errors", () => {
        const errors = validateProject(ex.file).filter((i) => i.level === "error");
        expect(errors).toEqual([]);
      });

      // The refreshed examples must include cables, breakers and CTs.
      test("includes a cable, a breaker and a CT", () => {
        const hasCable = ex.file.components.some((c) => c.type === "cable");
        const hasBreaker = ex.file.components.some(
          (c) => c.type === "switch" && (c.parameters as { device_type: string }).device_type === "breaker",
        );
        const hasCt = ex.file.connections.some((c) => c.ct);
        expect(hasCable).toBe(true);
        expect(hasBreaker).toBe(true);
        expect(hasCt).toBe(true);
      });

      test("every CT has a sane rating", () => {
        for (const conn of ex.file.connections) {
          if (!conn.ct) continue;
          const ct = conn.ct as CtParams;
          expect(ct.primary_a).toBeGreaterThan(0);
          expect([1, 5]).toContain(ct.secondary_a);
        }
      });

      test("every relay points at a CT-equipped wire that exists", () => {
        for (const comp of ex.file.components) {
          if (comp.type !== "relay") continue;
          const measuredId = (comp.parameters as { measured_connection_id: string | null }).measured_connection_id;
          const wire = ex.file.connections.find((c) => c.id === measuredId);
          expect(wire, `${comp.label} measures a missing wire`).toBeDefined();
          expect(wire?.ct, `${comp.label}'s measured wire has no CT`).toBeTruthy();
        }
      });
    });
  }

  test("the ring main warns about its two grid sources", () => {
    const ring = EXAMPLES.find((e) => e.id === "ring-main-33")!;
    const warnings = validateProject(ring.file).filter((i) => i.level === "warning");
    expect(warnings.some((w) => /grid source/i.test(w.message))).toBe(true);
  });
});
