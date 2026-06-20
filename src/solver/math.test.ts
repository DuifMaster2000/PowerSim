import { describe, test, expect } from "vitest";
import {
  C, cAdd, cSub, cMul, cDiv, cAbs, cInv, cConj,
  solveLinear, invertComplexMatrix, identity,
} from "./math";

describe("complex arithmetic", () => {
  test("add / sub / mul / div", () => {
    expect(cAdd(C(1, 2), C(3, 4))).toEqual({ re: 4, im: 6 });
    expect(cSub(C(1, 2), C(3, 4))).toEqual({ re: -2, im: -2 });
    // (1+2i)(3+4i) = 3 + 4i + 6i + 8i² = -5 + 10i
    expect(cMul(C(1, 2), C(3, 4))).toEqual({ re: -5, im: 10 });
    // (1+2i)/(3+4i) = (11 + 2i)/25
    const d = cDiv(C(1, 2), C(3, 4));
    expect(d.re).toBeCloseTo(11 / 25, 10);
    expect(d.im).toBeCloseTo(2 / 25, 10);
  });

  test("abs / conj / inverse", () => {
    expect(cAbs(C(3, 4))).toBe(5);
    expect(cConj(C(3, 4))).toEqual({ re: 3, im: -4 });
    // 1/(0+2i) = -0.5i
    const inv = cInv(C(0, 2));
    expect(inv.re).toBeCloseTo(0, 10);
    expect(inv.im).toBeCloseTo(-0.5, 10);
  });
});

describe("solveLinear (Gaussian elimination)", () => {
  test("solves a 2x2 system", () => {
    // 2a + b = 3 ; a + 3b = 5  →  a = 0.8, b = 1.4
    const x = solveLinear([[2, 1], [1, 3]], [3, 5]);
    expect(x[0]).toBeCloseTo(0.8, 10);
    expect(x[1]).toBeCloseTo(1.4, 10);
  });

  test("needs partial pivoting (zero leading pivot)", () => {
    // Row swap required: first pivot is 0.
    const x = solveLinear([[0, 1], [1, 0]], [2, 3]);
    expect(x[0]).toBeCloseTo(3, 10);
    expect(x[1]).toBeCloseTo(2, 10);
  });

  test("throws on a singular matrix", () => {
    expect(() => solveLinear([[1, 1], [1, 1]], [1, 2])).toThrow(/singular/i);
  });
});

describe("invertComplexMatrix", () => {
  test("inverts a diagonal complex matrix", () => {
    // diag(2, 4i) → diag(0.5, -0.25i)
    const re = [[2, 0], [0, 0]];
    const im = [[0, 0], [0, 4]];
    const { re: ir, im: ii } = invertComplexMatrix(re, im);
    expect(ir[0][0]).toBeCloseTo(0.5, 10);
    expect(ii[0][0]).toBeCloseTo(0, 10);
    expect(ir[1][1]).toBeCloseTo(0, 10);
    expect(ii[1][1]).toBeCloseTo(-0.25, 10);
  });

  test("inverse times original ≈ identity", () => {
    const re = [[4, 1], [1, 3]];
    const im = [[2, 0], [0, 1]];
    const { re: ir, im: ii } = invertComplexMatrix(re, im);
    // Multiply (re + j·im)(ir + j·ii) and check ≈ I.
    const n = 2;
    const I = identity(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let pr = 0;
        let pi = 0;
        for (let k = 0; k < n; k++) {
          pr += re[i][k] * ir[k][j] - im[i][k] * ii[k][j];
          pi += re[i][k] * ii[k][j] + im[i][k] * ir[k][j];
        }
        expect(pr).toBeCloseTo(I[i][j], 8);
        expect(pi).toBeCloseTo(0, 8);
      }
    }
  });
});
