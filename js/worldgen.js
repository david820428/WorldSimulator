// Layer 1: tectonic plates -> land and ocean.  See the README for the reasoning.
import { mulberry32, hashSeed, Noise } from './random.js';
import { applyElevation } from './elevation.js';
import { applyVolcanoes } from './volcanoes.js';
import { applyTemperature } from './temperature.js';
import { TERRAIN } from './map.js';

const ROW = Math.sqrt(3) / 2;       // row spacing relative to tile width

export const DEFAULTS = {
  continents: 5,          // number of continental plates
  oceanPlates: 9,         // number of oceanic plates
  landRatio: 0.30,        // land share of all tiles (3 : 7)
  aspect: [2.0, 3.2],     // how elongated a continental plate is
  continentRadius: 10,    // base plate size (tiles)
  oceanRadius: 8,
  warp: 3.5,              // how much plate borders wiggle (tiles)
  coastNoise: 1.0,        // coastline roughness
  collideChance: 0.12,    // chance that two touching continental plates collide and fuse
  minIsland: 3,           // specks smaller than this are cleaned up
};

export function generateWorld(map, seed, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const rng = mulberry32(hashSeed(String(seed)));
  const noise = new Noise(rng);
  const W = map.cols;
  const H = map.rows * ROW;
  const N = map.size;

  const wrapDx = (a, b) => { let d = Math.abs(a - b) % W; return d > W / 2 ? W - d : d; };
  const tileX = (c, r) => c + 0.5 * (r & 1);

  // ---- 1. Place the plates -------------------------------------------------
  const plates = [];
  const nH = 1 + Math.floor(rng() * (o.continents - 1));        // 1..4 horizontal
  const orient = shuffle(Array.from({ length: o.continents }, (_, i) => (i < nH ? 'horizontal' : 'vertical')), rng);

  for (let i = 0; i < o.continents; i++) {
    let x, y, tries = 0;
    do {
      x = rng() * W; y = H * (0.15 + 0.7 * rng()); tries++;
    } while (tries < 40 && plates.some(p => Math.hypot(wrapDx(p.x, x), p.y - y) < 8));
    const k = o.aspect[0] + rng() * (o.aspect[1] - o.aspect[0]);
    const s = 0.85 + 0.3 * rng();
    let a = o.continentRadius * s * Math.sqrt(k);                // long radius
    const b = o.continentRadius * s / Math.sqrt(k);              // short radius
    a = Math.min(a, orient[i] === 'vertical' ? H * 0.55 : W * 0.4);
    plates.push({ id: i, type: 'continental', orientation: orient[i], x, y, a, b,
                  name: 'Continent ' + String.fromCharCode(65 + i) });
  }
  for (let j = 0; j < o.oceanPlates; j++) {
    let best = null, bestD = -1;
    for (let t = 0; t < 12; t++) {                               // best-candidate spacing
      const x = rng() * W, y = H * rng();
      const d = Math.min(...plates.map(p => Math.hypot(wrapDx(p.x, x), p.y - y)));
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
    const R = o.oceanRadius * (0.8 + 0.4 * rng());
    plates.push({ id: plates.length, type: 'oceanic', orientation: null, x: best.x, y: best.y,
                  a: R, b: R, name: 'Ocean plate ' + (j + 1) });
  }

  // Which pairs of continental plates are colliding (their border becomes a joined suture)?
  const collide = new Set();
  for (let i = 0; i < o.continents; i++)
    for (let j = i + 1; j < o.continents; j++) if (rng() < o.collideChance) collide.add(i * 64 + j);
  for (const p of plates) p.collidesWith = [];
  for (const key of collide) {
    const i = Math.floor(key / 64), j = key % 64;
    plates[i].collidesWith.push(j); plates[j].collidesWith.push(i);
  }

  // Plate motion. Every plate drifts in a random direction; colliding pairs head
  // straight at each other. This decides which borders push, pull or slide.
  for (const p of plates) {
    const ang = rng() * Math.PI * 2, sp = 0.6 + 0.4 * rng();
    p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp;
  }
  for (const key of collide) {
    const a = plates[Math.floor(key / 64)], b = plates[key % 64];
    let dx = b.x - a.x; dx -= W * Math.round(dx / W);          // shortest way round the world
    let dy = b.y - a.y; const L = Math.hypot(dx, dy) || 1;
    a.vx = dx / L * 0.9; a.vy = dy / L * 0.9; b.vx = -a.vx; b.vy = -a.vy;
  }
  const colliding = (a, b) => collide.has(Math.min(a, b) * 64 + Math.max(a, b));

  // ---- 2. Give every tile to a plate (warped, stretched Voronoi) -----------
  const plateOf = new Uint8Array(N);
  const isCont = new Uint8Array(N);
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const x = tileX(c, r), y = r * ROW, u = x / W, v = y / W;
      const wx = x + (noise.fbm(u, v, 3, 3) - 0.5) * 2 * o.warp;
      const wy = y + (noise.fbm(u, v + 13.7, 3, 3) - 0.5) * 2 * o.warp;
      let best = 0, bestD = Infinity;
      for (const p of plates) {
        const dx = wrapDx(wx, p.x), dy = wy - p.y;
        let d;
        if (p.type === 'oceanic') d = Math.hypot(dx, dy) / p.a;
        else if (p.orientation === 'horizontal') d = Math.hypot(dx / p.a, dy / p.b);
        else d = Math.hypot(dy / p.a, dx / p.b);
        if (d < bestD) { bestD = d; best = p.id; }
      }
      const i = r * map.cols + c;
      plateOf[i] = best;
      isCont[i] = plates[best].type === 'continental' ? 1 : 0;
    }
  }

  // ---- 3. Depth: how far inside its plate type is each tile? ---------------
  // A continental tile on a plate edge (next to ocean, or next to a plate it is not
  // colliding with) has depth 1. Depth then grows inland, crossing sutures freely.
  const fromEdge = new Int16Array(N);
  const queue = new Int32Array(N);
  let head = 0, tail = 0;
  const nbrs = (i) => map.neighbors(i % map.cols, (i / map.cols) | 0);
  for (let i = 0; i < N; i++) {
    if (!isCont[i]) continue;
    for (const [nc, nr] of nbrs(i)) {
      const j = nr * map.cols + nc;
      if (!isCont[j] || (plateOf[j] !== plateOf[i] && !colliding(plateOf[i], plateOf[j]))) {
        fromEdge[i] = 1; queue[tail++] = i; break;
      }
    }
  }
  while (head < tail) {
    const i = queue[head++];
    for (const [nc, nr] of nbrs(i)) {
      const j = nr * map.cols + nc;
      if (isCont[j] && !fromEdge[j]) { fromEdge[j] = fromEdge[i] + 1; queue[tail++] = j; }
    }
  }
  const fromCont = distanceFrom(map, isCont);     // for oceanic tiles
  const maxDepth = new Float32Array(plates.length).fill(1);
  for (let i = 0; i < N; i++) if (isCont[i]) maxDepth[plateOf[i]] = Math.max(maxDepth[plateOf[i]], fromEdge[i]);

  const field = new Float32Array(N);
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const i = r * map.cols + c;
      const base = isCont[i] ? fromEdge[i] / maxDepth[plateOf[i]]
                             : -Math.min(1, fromCont[i] / 5);
      const n = noise.fbm(tileX(c, r) / W, r * ROW / W + 29.1, 5, 4);
      field[i] = base + (n - 0.5) * o.coastNoise;
    }
  }

  // ---- 4. Sea level = percentile, so land share is exact -------------------
  const sorted = Float32Array.from(field).sort();
  const level = sorted[Math.floor(N * (1 - o.landRatio))];
  const land = new Uint8Array(N);
  for (let i = 0; i < N; i++) land[i] = field[i] > level ? 1 : 0;

  // ---- 5. Clean specks: tiny islands vanish, tiny lakes fill ---------------
  for (const value of [1, 0]) {
    const { labels, sizes } = components(map, land, value);
    for (let i = 0; i < N; i++) if (land[i] === value && sizes[labels[i]] < o.minIsland) land[i] = 1 - value;
  }

  // ---- 6. Write results and report ----------------------------------------
  for (let i = 0; i < N; i++) map.terrain[i] = land[i];
  map.plate = plateOf; map.plates = plates; map.field = field;
  const elevation = applyElevation(map, noise);   // layer 2: turns 0/1 into 5 levels
  map.feature.fill(0);
  const volcanoes = applyVolcanoes(map, rng);     // layer 3: volcanoes (sea ones add small islands)
  for (let i = 0; i < N; i++) land[i] = TERRAIN[map.terrain[i]].land ? 1 : 0;   // islands count as land
  const temperature = applyTemperature(map);      // layer 4: latitude + height
  const levels = [0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) levels[map.terrain[i]]++;

  const { labels, sizes } = components(map, land, 1);
  const landTiles = land.reduce((s, v) => s + v, 0);
  const overlap = plates.filter(p => p.type === 'continental').map(() => new Map());
  for (let i = 0; i < N; i++) {
    if (land[i] && isCont[i]) {
      const m = overlap[plateOf[i]];
      m.set(labels[i], (m.get(labels[i]) || 0) + 1);
    }
  }
  const groups = new Map();                       // landmass label -> continental plates on it
  const landByPlate = [];
  overlap.forEach((m, pid) => {
    let bestL = -1, bestN = 0, total = 0;
    for (const [l, n] of m) { total += n; if (n > bestN) { bestN = n; bestL = l; } }
    landByPlate.push(total);
    if (bestL >= 0) groups.set(bestL, [...(groups.get(bestL) || []), pid]);
  });

  return {
    seed, landPct: landTiles / N * 100, elevation: levels, volcanoes, temperature,
    landmasses: sizes.filter(Boolean).sort((a, b) => b - a),
    landByPlate,
    fused: [...groups.values()].filter(g => g.length > 1),
  };
}

// ---- helpers ---------------------------------------------------------------

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Hex distance (in tiles) from the nearest tile where isSource is 1. Wraps east-west.
function distanceFrom(map, isSource) {
  const dist = new Int16Array(map.size).fill(-1);
  const queue = new Int32Array(map.size);
  let head = 0, tail = 0;
  for (let i = 0; i < map.size; i++) if (isSource[i]) { dist[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++];
    for (const [nc, nr] of map.neighbors(i % map.cols, (i / map.cols) | 0)) {
      const j = nr * map.cols + nc;
      if (dist[j] < 0) { dist[j] = dist[i] + 1; queue[tail++] = j; }
    }
  }
  return dist;
}

// Connected regions of tiles whose mask equals `value`. Label sizes returned by label.
function components(map, mask, value) {
  const labels = new Int32Array(map.size).fill(-1);
  const sizes = [];
  const stack = [];
  for (let s = 0; s < map.size; s++) {
    if (mask[s] !== value || labels[s] >= 0) continue;
    const id = sizes.length; let n = 0;
    labels[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop(); n++;
      for (const [nc, nr] of map.neighbors(i % map.cols, (i / map.cols) | 0)) {
        const j = nr * map.cols + nc;
        if (mask[j] === value && labels[j] < 0) { labels[j] = id; stack.push(j); }
      }
    }
    sizes.push(n);
  }
  return { labels, sizes };
}
