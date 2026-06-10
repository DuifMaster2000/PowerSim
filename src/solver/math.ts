// =====================================================================
// Minimal complex-number and linear-algebra helpers.
// Just enough for power-flow Y-bus and short-circuit Z-bus calculations.
// =====================================================================

export interface Complex {
  re: number;
  im: number;
}

export const C = (re: number, im: number = 0): Complex => ({ re, im });

export const cAdd = (a: Complex, b: Complex): Complex => ({
  re: a.re + b.re,
  im: a.im + b.im,
});

export const cSub = (a: Complex, b: Complex): Complex => ({
  re: a.re - b.re,
  im: a.im - b.im,
});

export const cMul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

export const cDiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};

export const cConj = (a: Complex): Complex => ({ re: a.re, im: -a.im });

export const cAbs = (a: Complex): number => Math.hypot(a.re, a.im);

export const cArg = (a: Complex): number => Math.atan2(a.im, a.re);

export const cFromPolar = (mag: number, angleRad: number): Complex => ({
  re: mag * Math.cos(angleRad),
  im: mag * Math.sin(angleRad),
});

export const cInv = (a: Complex): Complex => {
  const d = a.re * a.re + a.im * a.im;
  return { re: a.re / d, im: -a.im / d };
};

// ---------- Matrix utilities (real-valued, dense) ----------

export type Matrix = number[][];

export const zeros = (rows: number, cols: number): Matrix =>
  Array.from({ length: rows }, () => new Array(cols).fill(0));

export const identity = (n: number): Matrix => {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) m[i][i] = 1;
  return m;
};

/**
 * Solve A x = b via Gaussian elimination with partial pivoting.
 * Mutates copies, returns x. Throws if singular.
 */
export function solveLinear(A: Matrix, b: number[]): number[] {
  const n = A.length;
  // Augmented matrix
  const M: Matrix = A.map((row, i) => [...row, b[i]]);

  for (let k = 0; k < n; k++) {
    // partial pivot
    let maxRow = k;
    let maxVal = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(M[i][k]) > maxVal) {
        maxVal = Math.abs(M[i][k]);
        maxRow = i;
      }
    }
    if (maxVal < 1e-14) throw new Error("Singular matrix in linear solve");
    if (maxRow !== k) {
      const tmp = M[k];
      M[k] = M[maxRow];
      M[maxRow] = tmp;
    }
    // eliminate
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }

  // back-substitute
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * Invert a complex matrix represented as separate real and imaginary parts.
 * Returns { re, im } matrices.
 * Used to get Z-bus = inv(Y-bus) for short-circuit analysis.
 *
 * Method: stack as a real 2n×2n block matrix
 *   [ A  -B ]
 *   [ B   A ]
 * invert with Gauss-Jordan, then read upper-left / lower-left blocks.
 */
export function invertComplexMatrix(re: Matrix, im: Matrix): { re: Matrix; im: Matrix } {
  const n = re.length;
  const N = 2 * n;
  const big = zeros(N, N);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      big[i][j] = re[i][j];
      big[i][j + n] = -im[i][j];
      big[i + n][j] = im[i][j];
      big[i + n][j + n] = re[i][j];
    }
  }
  // augment with identity
  const aug: Matrix = big.map((row, i) => {
    const r = [...row];
    for (let j = 0; j < N; j++) r.push(i === j ? 1 : 0);
    return r;
  });
  // Gauss-Jordan
  for (let k = 0; k < N; k++) {
    let maxRow = k;
    let maxVal = Math.abs(aug[k][k]);
    for (let i = k + 1; i < N; i++) {
      if (Math.abs(aug[i][k]) > maxVal) {
        maxVal = Math.abs(aug[i][k]);
        maxRow = i;
      }
    }
    if (maxVal < 1e-14) throw new Error("Singular complex matrix in inversion");
    if (maxRow !== k) {
      const tmp = aug[k];
      aug[k] = aug[maxRow];
      aug[maxRow] = tmp;
    }
    const pivot = aug[k][k];
    for (let j = 0; j < 2 * N; j++) aug[k][j] /= pivot;
    for (let i = 0; i < N; i++) {
      if (i === k) continue;
      const f = aug[i][k];
      if (f === 0) continue;
      for (let j = 0; j < 2 * N; j++) aug[i][j] -= f * aug[k][j];
    }
  }
  const invRe = zeros(n, n);
  const invIm = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      invRe[i][j] = aug[i][j + N];
      invIm[i][j] = aug[i + n][j + N];
    }
  }
  return { re: invRe, im: invIm };
}
