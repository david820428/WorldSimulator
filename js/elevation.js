// Layer 2: elevation. Reads the plates from layer 1 and sorts every tile into
// one of five levels. Land and ocean stay exactly as layer 1 decided.

import { TERRAIN } from './map.js';

const ROW = Math.sqrt(3) / 2;
const DEEP = 0, SHALLOW = 1, LOW = 2, HILLS = 3, MOUNTAINS = 4;

export const ELEVATION_DEFAULTS = {
  mountainShare: 0.10,   // top 10% of land tiles
  hillShare: 0.27,       // next 27% of land tiles (the rest is lowland)
  shallowShare: 0.32,    // 32% of ocean tiles are shallow sea
  speedScale: 1.6,       // relative speed that counts as a full-strength collision
};

export function applyElevation(map, noise, opts = {}) {
  const o = { ...ELEVATION_DEFAULTS, ...opts };
  const N = map.size, W = map.cols, plates = map.plates, plateOf = map.plate;
  const wrapSigned = (d) => d - W * Math.round(d / W);
  const posX = (i) => (i % W) + 0.5 * (((i / W) | 0) & 1);
  const posY = (i) => ((i / W) | 0) * ROW;

  // Neighbour table, built once (6 slots per tile, -1 = off the map)
  const nb = new Int32Array(N * 6).fill(-1);
  for (let i = 0; i < N; i++) {
    map.neighbors(i % W, (i / W) | 0).forEach(([c, r], k) => { nb[i * 6 + k] = r * W + c; });
  }

  // ---- 1. Plate borders: how hard are the two plates pushing together? ------
  const uplift = new Float32Array(N);   // mountain building (continental side, island arcs)
  const trench = new Float32Array(N);   // oceanic plate diving under another
  const ridge = new Float32Array(N);    // oceanic plates pulling apart

  for (let i = 0; i < N; i++) {
    const pi = plates[plateOf[i]];
    for (let k = 0; k < 6; k++) {
      const j = nb[i * 6 + k];
      if (j < 0 || plateOf[j] === plateOf[i]) continue;
      const pj = plates[plateOf[j]];

      // direction from tile i toward tile j, and relative speed along it
      let nx = wrapSigned(posX(j) - posX(i)), ny = posY(j) - posY(i);
      const len = Math.hypot(nx, ny); nx /= len; ny /= len;
      const conv = (pi.vx - pj.vx) * nx + (pi.vy - pj.vy) * ny;   // > 0 means approaching
      const iCont = pi.type === 'continental', jCont = pj.type === 'continental';

      if (conv > 0) {
        const s = Math.min(1, conv / o.speedScale);
        if (iCont && jCont) {
          const colliding = pi.collidesWith.includes(pj.id);
          uplift[i] = Math.max(uplift[i], s * (colliding ? 1.2 : 0.6));    // continental collision
        } else if (iCont) {
          uplift[i] = Math.max(uplift[i], s);                              // subduction: coastal range
        } else if (jCont) {
          trench[i] = Math.max(trench[i], s);                              // ...and its ocean trench
        } else if (pi.id < pj.id) {
          uplift[i] = Math.max(uplift[i], s * 0.7);                        // island arc
        } else {
          trench[i] = Math.max(trench[i], s);
        }
      } else if (!iCont && !jCont) {
        ridge[i] = Math.max(ridge[i], Math.min(1, -conv / o.speedScale)); // mid-ocean ridge
      }
    }
  }

  // ---- 2. Spread each effect inward, fading with distance -------------------
  const up = spread(nb, plateOf, uplift, 0.80);
  const tr = spread(nb, plateOf, trench, 0.60);
  const rd = spread(nb, plateOf, ridge, 0.70);
  map.uplift = up;

  // ---- 3. Land: three levels by rank ---------------------------------------
  const landIdx = [], landScore = [];
  const oceanIdx = [], oceanScore = [];
  const isLand = (i) => map.terrain[i] >= 1 && TERRAIN[map.terrain[i]].land !== false;
  const landMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) landMask[i] = map.terrain[i] === 1 ? 1 : 0;   // layer 1: 1 = land
  const distLand = distanceFrom(nb, landMask);

  for (let i = 0; i < N; i++) {
    const u = posX(i) / W, v = posY(i) / W;
    if (landMask[i]) {
      const n = noise.fbm(u, v + 50.7, 6, 4);
      landIdx.push(i); landScore.push(1.1 * up[i] + 0.7 * (n - 0.5));
    } else {
      const n = noise.fbm(u, v + 70.3, 5, 4);
      oceanIdx.push(i);
      oceanScore.push(-Math.min(distLand[i], 12) / 12 + 0.45 * up[i] + 0.4 * rd[i] - 0.5 * tr[i] + (n - 0.5) * 0.5);
    }
  }

  const mtnCut = quantile(landScore, 1 - o.mountainShare);
  const hillCut = quantile(landScore, 1 - o.mountainShare - o.hillShare);
  landIdx.forEach((i, k) => {
    map.terrain[i] = landScore[k] > mtnCut ? MOUNTAINS : landScore[k] > hillCut ? HILLS : LOW;
  });

  // ---- 4. Ocean: shallow shelf vs deep ocean --------------------------------
  const shallowCut = quantile(oceanScore, 1 - o.shallowShare);
  oceanIdx.forEach((i, k) => {
    map.terrain[i] = (oceanScore[k] > shallowCut || distLand[i] === 1) ? SHALLOW : DEEP;
  });

  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) counts[map.terrain[i]]++;
  return counts;
}

// ---- helpers ---------------------------------------------------------------

// Let each tile take the strongest nearby source, weakened by `decay` per tile.
// Effects stay on their own plate, so mountains don't leak across a border.
function spread(nb, plateOf, src, decay) {
  const a = Float32Array.from(src);
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (let i = 0; i < a.length; i++) {
      for (let k = 0; k < 6; k++) {
        const j = nb[i * 6 + k];
        if (j < 0 || plateOf[j] !== plateOf[i]) continue;
        const v = a[j] * decay;
        if (v > a[i] + 1e-4) { a[i] = v; changed = true; }
      }
    }
    if (!changed) break;
  }
  return a;
}

function distanceFrom(nb, mask) {
  const n = mask.length, dist = new Int16Array(n).fill(-1), q = new Int32Array(n);
  let h = 0, t = 0;
  for (let i = 0; i < n; i++) if (mask[i]) { dist[i] = 0; q[t++] = i; }
  while (h < t) {
    const i = q[h++];
    for (let k = 0; k < 6; k++) {
      const j = nb[i * 6 + k];
      if (j >= 0 && dist[j] < 0) { dist[j] = dist[i] + 1; q[t++] = j; }
    }
  }
  return dist;
}

function quantile(values, p) {
  const s = Float32Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
}
