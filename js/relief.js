// Layer 2b: relief noise. Runs right after the plate-based elevation and before
// volcanoes, temperature and rainfall, so every later layer sees these features.
//
// Every feature is a short "stroke": 2-5 tiles in a straight hex row, 1 or 2 tiles wide.
//   mountain / hill ranges  anywhere on land
//   basins                  carved out of mountains and hills (valleys, passes)
//   lakes                   rarer, on lowland away from the sea
//   ocean islands           small, sitting in a ring of shallow sea

const DEEP = 0, SHALLOW = 1, LOW = 2, HILLS = 3, MOUNTAINS = 4, LAKE = 5;
const ROW = Math.sqrt(3) / 2;

export const RELIEF_DEFAULTS = {
  // one feature per this many land (or ocean) tiles, each count varied by +-25%
  landPerMountainRange: 130,
  landPerHillRange: 80,
  landPerBasin: 200,
  landPerLake: 240,        // lakes are rarer than ranges
  oceanPerIsland: 450,

  length: [2, 5],          // tiles in a row
  twoWideChance: 0.5,      // otherwise 1 wide
  widthFill: 0.85,         // how completely the second row is filled
  tries: 40,               // attempts to place each feature

  ruggedBias: 0.5,         // start-point weight = bias + smooth noise (mild clustering)
  lakeReliefBonus: 2,      // lakes favour lowland within reach of hills or mountains...
  lakeReliefReach: 3,
  lakeCoastGap: 2,         // ...and keep at least this far from the sea
  islandCoastGap: 3,       // islands stay this far from existing land
  shelfWeight: 3,          // islands prefer shallow sea over deep ocean
  arcWeight: 2,            // and places near volcanic plate borders
  islandHillChance: 0.25,  // an island tile is a hill instead of lowland
};

export function applyRelief(map, noise, rng, opts = {}) {
  const o = { ...RELIEF_DEFAULTS, ...opts };
  const N = map.size, W = map.cols, ter = map.terrain;
  const col = (i) => i % W, row = (i) => (i / W) | 0;
  const rint = ([a, b]) => a + Math.floor(rng() * (b - a + 1));
  const isLandT = (t) => t >= LOW && t <= MOUNTAINS;
  const isOceanT = (t) => t === DEEP || t === SHALLOW;
  const nbrs = (i) => map.neighbors(col(i), row(i)).map(([c, r]) => r * W + c);
  const px = (i) => (col(i) + 0.5 * (row(i) & 1)) / W, py = (i) => (row(i) * ROW) / W;

  // Ranges and basins line up with a smooth "grain" across the map, so neighbouring
  // features run the same way (like real fold belts) instead of pointing randomly.
  // axis 0 = east-west, 1 = north-east/south-west, 2 = north-west/south-east
  const axisAt = (i) => Math.round(noise.value(px(i) * 5, py(i) * 5 + 90.1, 5) * 3) % 3;
  const rugged = (i) => o.ruggedBias + noise.fbm(px(i), py(i) + 120.3, 4, 3);

  function pick(weights) {
    let sum = 0;
    for (let i = 0; i < N; i++) sum += weights[i];
    if (sum <= 0) return -1;
    let r = rng() * sum;
    for (let i = 0; i < N; i++) if (weights[i] > 0 && (r -= weights[i]) <= 0) return i;
    return -1;
  }

  // 2-5 tiles along one hex direction, optionally with a second parallel row
  function stroke(start, axis, allowed) {
    const length = rint(o.length), tiles = [];
    for (let cur = start, k = 0; k < length && cur >= 0 && allowed(cur); k++) {
      tiles.push(cur);
      cur = map.step(col(cur), row(cur), axis);
    }
    if (rng() < o.twoWideChance) {
      const side = rng() < 0.5 ? (axis + 1) % 6 : (axis + 5) % 6;
      for (const t of [...tiles]) {
        const j = map.step(col(t), row(t), side);
        if (j >= 0 && !tiles.includes(j) && allowed(j) && rng() < o.widthFill) tiles.push(j);
      }
    }
    return tiles;
  }

  function distanceFrom(isSource) {
    const dist = new Int16Array(N).fill(-1), q = [];
    for (let i = 0; i < N; i++) if (isSource(i)) { dist[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) for (const j of nbrs(q[h])) if (dist[j] < 0) { dist[j] = dist[q[h]] + 1; q.push(j); }
    return dist;
  }

  let landTiles = 0;
  for (let i = 0; i < N; i++) if (isLandT(ter[i])) landTiles++;
  const oceanTiles = N - landTiles;
  const count = (per, total) => Math.round(total / per * (0.75 + 0.5 * rng()));
  const stats = { mountainRanges: 0, hillRanges: 0, basins: 0, lakes: 0, islands: 0 };

  // ---- 1. Mountain and hill ranges, anywhere on land ---------------------------
  function placeRange(kind) {
    for (let t = 0; t < o.tries; t++) {
      const w = new Float32Array(N);
      for (let i = 0; i < N; i++) if (isLandT(ter[i])) w[i] = rugged(i);
      const s = pick(w);
      if (s < 0) return false;
      const tiles = stroke(s, axisAt(s), (i) => isLandT(ter[i]));
      const changes = tiles.filter(i => kind === 'mountain' ? ter[i] !== MOUNTAINS : ter[i] === LOW);
      if (tiles.length < 2 || changes.length < 2) continue;           // must visibly change something
      for (const i of tiles) ter[i] = kind === 'mountain' ? MOUNTAINS : Math.max(ter[i], HILLS);
      return true;
    }
    return false;
  }
  for (let n = count(o.landPerMountainRange, landTiles); n > 0; n--) if (placeRange('mountain')) stats.mountainRanges++;
  for (let n = count(o.landPerHillRange, landTiles); n > 0; n--) if (placeRange('hill')) stats.hillRanges++;

  // ---- 2. Basins: valleys cut into mountains and hills -------------------------
  // Start inside a mountain, or on a hill right beside one. These make passes too.
  for (let n = count(o.landPerBasin, landTiles); n > 0; n--) {
    for (let t = 0; t < o.tries; t++) {
      const w = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        if (ter[i] === MOUNTAINS) w[i] = 3;
        else if (ter[i] === HILLS && nbrs(i).some(j => ter[j] === MOUNTAINS)) w[i] = 1.5;
      }
      const s = pick(w);
      if (s < 0) break;
      const tiles = stroke(s, axisAt(s), (i) => ter[i] === MOUNTAINS || ter[i] === HILLS);
      if (tiles.length < 2) continue;
      for (const i of tiles) ter[i] = LOW;
      stats.basins++;
      break;
    }
  }

  // ---- 3. Lakes: lowland, away from the sea, more likely in the lee of relief ---
  const distSea = distanceFrom((i) => isOceanT(ter[i]));
  const distRelief = distanceFrom((i) => ter[i] === HILLS || ter[i] === MOUNTAINS);
  for (let n = count(o.landPerLake, landTiles); n > 0; n--) {
    const allowed = (i) => ter[i] === LOW && distSea[i] >= o.lakeCoastGap && !nbrs(i).some(j => ter[j] === LAKE);
    for (let t = 0; t < o.tries; t++) {
      const w = new Float32Array(N);
      for (let i = 0; i < N; i++) if (allowed(i)) w[i] = 1 + (distRelief[i] >= 0 && distRelief[i] <= o.lakeReliefReach ? o.lakeReliefBonus : 0);
      const s = pick(w);
      if (s < 0) break;
      const tiles = stroke(s, Math.floor(rng() * 3), allowed);       // lakes take any direction
      if (tiles.length < 2) continue;
      for (const i of tiles) ter[i] = LAKE;
      stats.lakes++;
      break;
    }
  }

  // ---- 4. Ocean islands, wrapped in shallow sea --------------------------------
  for (let n = count(o.oceanPerIsland, oceanTiles); n > 0; n--) {
    const distLand = distanceFrom((i) => isLandT(ter[i]));            // fresh: earlier islands count
    const allowed = (i) => isOceanT(ter[i]) && distLand[i] >= o.islandCoastGap;
    for (let t = 0; t < o.tries; t++) {
      const w = new Float32Array(N);
      for (let i = 0; i < N; i++) if (allowed(i)) w[i] = (ter[i] === SHALLOW ? o.shelfWeight : 1) * (1 + o.arcWeight * map.volcanic[i]);
      const s = pick(w);
      if (s < 0) break;
      const tiles = stroke(s, Math.floor(rng() * 3), allowed);
      if (tiles.length < 2) continue;
      for (const i of tiles) ter[i] = rng() < o.islandHillChance ? HILLS : LOW;
      for (const i of tiles) for (const j of nbrs(i)) if (ter[j] === DEEP) ter[j] = SHALLOW;
      stats.islands++;
      break;
    }
  }
  return stats;
}
