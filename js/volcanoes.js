// Layer 3: volcanoes. A small garnish on top of plates and elevation.
// Volcanoes are a *feature* (map.feature), not a terrain type, so a volcano sitting
// on a plain stays a plain. The only terrain change: a volcano born at sea builds an island.

import { TERRAIN } from './map.js';

const SHALLOW = 1, LOW = 2, MOUNTAINS = 4;
const ROW = Math.sqrt(3) / 2;

export const VOLCANO_DEFAULTS = {
  count: [9, 14],        // total volcanoes per world (min, max)
  hotspotShare: 0.10,    // about 10% ignore plate borders entirely
  minSpacing: 4.5,       // tiles between any two volcanoes
  minPotential: 0.12,    // below this a tile is "not near a volcanic border"
  maxIslands: 2,         // cap on volcanoes born at sea
  islandCoastGap: 3,     // an island volcano must be at least this far from existing land
  islandExtra: [2, 4],   // plain-land tiles added around an island volcano
};

export function applyVolcanoes(map, rng, opts = {}) {
  const o = { ...VOLCANO_DEFAULTS, ...opts };
  const N = map.size, W = map.cols;
  const isLand = (i) => TERRAIN[map.terrain[i]].land;     // lakes are water, not land
  const nbrs = (i) => map.neighbors(i % W, (i / W) | 0).map(([c, r]) => r * W + c);
  const wrapSigned = (d) => d - W * Math.round(d / W);
  const px = (i) => (i % W) + 0.5 * (((i / W) | 0) & 1);
  const py = (i) => ((i / W) | 0) * ROW;
  const rint = ([a, b]) => a + Math.floor(rng() * (b - a + 1));

  // distance from the nearest land tile, for every tile
  const distLand = new Int16Array(N).fill(-1);
  const queue = [];
  for (let i = 0; i < N; i++) if (isLand(i)) { distLand[i] = 0; queue.push(i); }
  for (let h = 0; h < queue.length; h++) {
    for (const j of nbrs(queue[h])) if (distLand[j] < 0) { distLand[j] = distLand[queue[h]] + 1; queue.push(j); }
  }

  const total = rint(o.count);
  const hotspots = Math.floor(total * o.hotspotShare + rng());   // 10% on average (0, 1 or 2 per world)
  const placed = [];
  let islands = 0;

  const farEnough = (i) => placed.every(p =>
    Math.hypot(wrapSigned(px(i) - px(p.tile)), py(i) - py(p.tile)) >= o.minSpacing);

  // Weighted random pick; keeps drawing until a candidate passes every check.
  function place(kind, weightOf) {
    const w = new Float32Array(N);
    let sum = 0;
    for (let i = 0; i < N; i++) {
      if (!isLand(i) && (distLand[i] < o.islandCoastGap || islands >= o.maxIslands)) continue;
      w[i] = weightOf(i); sum += w[i];
    }
    for (let tries = 0; tries < 300 && sum > 0; tries++) {
      let r = rng() * sum, pick = -1;
      for (let i = 0; i < N; i++) { if (w[i] > 0 && (r -= w[i]) <= 0) { pick = i; break; } }
      if (pick < 0) return;
      const island = !isLand(pick);
      if (farEnough(pick) && (!island || nbrs(pick).length >= o.islandExtra[0])) {
        placed.push({ tile: pick, kind, island });
        if (island) { islands++; buildIsland(pick); }
        map.feature[pick] = 1;
        return;
      }
      sum -= w[pick]; w[pick] = 0;
    }
  }

  // A volcano born at sea: cone becomes mountain, a few neighbours become plain land.
  function buildIsland(v) {
    map.terrain[v] = MOUNTAINS;
    const ring = nbrs(v).sort(() => rng() - 0.5).slice(0, rint(o.islandExtra));
    for (const j of ring) map.terrain[j] = LOW;
    for (const t of [v, ...ring]) {                       // keep the coast navigable
      for (const j of nbrs(t)) if (map.terrain[j] === 0) map.terrain[j] = SHALLOW;
    }
  }

  // 90%: along plate borders (subduction arcs and ocean ridges), strongest near the border.
  // The rest: hotspots, anywhere that is NOT close to a border (think Hawaii, Yellowstone).
  for (let k = 0; k < total - hotspots; k++) {
    place('boundary', (i) => map.volcanic[i] >= o.minPotential
      ? Math.pow(map.volcanic[i], 1.5) * (isLand(i) ? 1 : 0.08) : 0);
  }
  for (let k = 0; k < hotspots; k++) {
    place('hotspot', (i) => map.volcanic[i] < o.minPotential ? 1 : 0);
  }
  return placed;
}
