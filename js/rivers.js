// Layer 7: rivers. A tile-based feature (map.river holds a river number, 0 = none).
// Rivers never change terrain, temperature or rainfall; they are for later game systems.
//
// Rules: only on continents (not islands), only on land tiles (never lakes or sea),
// and the terrain level never rises along the way: mountains -> hills -> lowland -> sea.

import { TERRAIN } from './map.js';

const ROW = Math.sqrt(3) / 2;

export const RIVER_DEFAULTS = {
  continentMinTiles: 30,    // a landmass at least this big is a continent (smaller = island)
  minPerContinent: 2,
  maxTotal: 20,             // hard cap for the whole world
  minLength: 3,             // tiles per river (relaxed only if a continent cannot fit its minimum)
  sourceSpacing: 4,         // tiles between two river sources
  meander: 0.3,             // chance weight of a sideways step instead of a step toward the sea
  allowTributaries: true,   // a river may end by joining another river that reaches the sea
  tries: 60,                // placement attempts per river
};

export function applyRivers(map, rng, opts = {}) {
  const o = { ...RIVER_DEFAULTS, ...opts };
  const N = map.size, W = map.cols, ter = map.terrain;
  map.river.fill(0);
  map.riverTo.fill(-1);

  const nbrs = (i) => map.neighbors(i % W, (i / W) | 0).map(([c, r]) => r * W + c);
  const px = (i) => (i % W) + 0.5 * (((i / W) | 0) & 1), py = (i) => ((i / W) | 0) * ROW;
  const wrapSigned = (d) => d - W * Math.round(d / W);
  const gap = (a, b) => Math.hypot(wrapSigned(px(a) - px(b)), py(a) - py(b));

  // ---- 1. Find the continents (big connected landmasses) --------------------
  const comp = new Int32Array(N).fill(-1), groups = [];
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0 || !TERRAIN[ter[s]].land) continue;
    const tiles = [s]; comp[s] = groups.length;
    for (let h = 0; h < tiles.length; h++)
      for (const j of nbrs(tiles[h])) if (comp[j] < 0 && TERRAIN[ter[j]].land) { comp[j] = groups.length; tiles.push(j); }
    groups.push(tiles);
  }
  const continents = groups.filter(g => g.length >= o.continentMinTiles).map(tiles => ({ tiles, placed: 0 }));
  const contOf = new Int32Array(N).fill(-1);
  continents.forEach((c, k) => c.tiles.forEach(i => { contOf[i] = k; }));
  const result = { count: 0, tiles: 0, perContinent: [], list: [] };
  if (!continents.length) return result;

  // River tiles must be on a continent and must not be a volcano.
  const eligible = (i) => contOf[i] >= 0 && map.feature[i] === 0;

  // ---- 2. flowDist: fewest steps to the sea using only moves that never go uphill ----
  // Built backwards from the coast: tile u can feed tile v if u is at the same level or higher.
  const flowDist = new Int16Array(N).fill(-1), queue = [];
  for (let i = 0; i < N; i++) {
    if (eligible(i) && nbrs(i).some(j => ter[j] <= 1)) { flowDist[i] = 0; queue.push(i); }
  }
  for (let h = 0; h < queue.length; h++) {
    const v = queue[h];
    for (const u of nbrs(v)) {
      if (flowDist[u] < 0 && eligible(u) && ter[u] >= ter[v]) { flowDist[u] = flowDist[v] + 1; queue.push(u); }
    }
  }

  // ---- 3. How many rivers? Random, at least 2 per continent, at most 20 in all ----
  const C = continents.length;
  const base = Math.min(o.minPerContinent, Math.floor(o.maxTotal / C));
  const room = o.maxTotal - base * C;
  const extra = Math.floor(rng() * (Math.min(room, 2 * C + 4) + 1));
  const quota = new Array(C).fill(base);
  const totalSize = continents.reduce((a, c) => a + c.tiles.length, 0);
  for (let e = 0; e < extra; e++) {                       // bigger continents attract more extras
    let r = rng() * totalSize, k = 0;
    while (k < C - 1 && (r -= continents[k].tiles.length) > 0) k++;
    quota[k]++;
  }

  // ---- 4. Place the rivers ---------------------------------------------------
  const sources = [];
  let nextId = 0;

  function tryPlace(c, minLen, spacing) {
    // pick a source: highlands and wet land preferred, and rivers that have room to run
    const w = new Float32Array(N);
    let sum = 0;
    for (const i of c.tiles) {
      if (!eligible(i) || map.river[i] || flowDist[i] < minLen - 1) continue;
      if (spacing && sources.some(s => gap(s, i) < spacing)) continue;
      w[i] = (ter[i] - 1) * (0.25 + Math.min(1.5, map.precipitation[i] / 1000)) * (1 + flowDist[i] / 8);
      sum += w[i];
    }
    if (sum <= 0) return false;
    let r = rng() * sum, src = -1;
    for (const i of c.tiles) if (w[i] > 0 && (r -= w[i]) <= 0) { src = i; break; }
    if (src < 0) return false;

    // walk downhill: never to a higher level, never further from the sea (in flowDist terms)
    const path = [src], seen = new Set(path);
    let u = src, joined = -1;
    while (flowDist[u] > 0) {
      const cand = [], cw = [];
      for (const v of nbrs(u)) {
        if (!eligible(v) || flowDist[v] < 0 || seen.has(v)) continue;
        if (ter[v] > ter[u] || flowDist[v] > flowDist[u]) continue;
        if (map.river[v] && !o.allowTributaries) continue;
        cand.push(v); cw.push(flowDist[v] < flowDist[u] ? 1 : o.meander);
      }
      if (!cand.length) return false;
      let t = rng() * cw.reduce((a, b) => a + b, 0), k = 0;
      while (k < cand.length - 1 && (t -= cw[k]) > 0) k++;
      const v = cand[k];
      if (map.river[v]) { joined = v; break; }              // flows into an existing river
      path.push(v); seen.add(v); u = v;
    }
    if (path.length < minLen) return false;

    const id = ++nextId;
    path.forEach((t, k) => {
      map.river[t] = id;
      map.riverTo[t] = k + 1 < path.length ? path[k + 1] : joined;   // -1 = mouth at the sea
    });
    sources.push(src);
    c.placed++;
    result.list.push({ id, continent: continents.indexOf(c), source: src, length: path.length, joins: joined >= 0 });
    return true;
  }

  continents.forEach((c, k) => {
    for (let n = 0; n < quota[k]; n++) {
      const mandatory = c.placed < o.minPerContinent;
      // stage 0: normal rules. 1: ignore spacing. 2: allow very short rivers (mandatory ones only)
      const stages = mandatory ? [[o.minLength, o.sourceSpacing], [o.minLength, 0], [2, 0]] : [[o.minLength, o.sourceSpacing], [o.minLength, 0]];
      let ok = false;
      for (const [minLen, spacing] of stages) {
        for (let t = 0; t < o.tries && !ok; t++) ok = tryPlace(c, minLen, spacing);
        if (ok) break;
      }
    }
  });

  result.count = nextId;
  result.tiles = map.river.reduce((a, v) => a + (v ? 1 : 0), 0);
  result.perContinent = continents.map(c => ({ size: c.tiles.length, count: c.placed }));
  return result;
}
