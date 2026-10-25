// Seeded randomness. Never use Math.random() inside world generation,
// so the same seed always produces the same world.

export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Value noise that tiles seamlessly in x, so the world has no seam where it wraps.
export class Noise {
  constructor(rng) {
    this.t = new Float32Array(256 * 256);
    for (let i = 0; i < this.t.length; i++) this.t[i] = rng();
  }

  // x repeats every `px` cells; y is free.
  value(x, y, px) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % px) + px) % px, x1 = (x0 + 1) % px;
    const y0 = iy & 255, y1 = (iy + 1) & 255;
    const t = this.t;
    const a = t[y0 * 256 + x0], b = t[y0 * 256 + x1];
    const c = t[y1 * 256 + x0], d = t[y1 * 256 + x1];
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  }

  // Fractal noise in 0..1. u = x / worldWidth, v = y / worldWidth.
  fbm(u, v, baseCells, octaves) {
    let amp = 1, sum = 0, norm = 0, cells = baseCells;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.value(u * cells, v * cells + o * 17.3, cells);
      norm += amp; amp *= 0.5; cells *= 2;
    }
    return sum / norm;
  }
}
