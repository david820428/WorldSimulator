// Layer 8: crop resources. Crops come from biomes only (never from elevation or latitude).
//
// For each crop type (CROPS in map.js):
//   candidates = walkable land tiles (lowland or hills, never impassable mountains) of the
//                crop's own biome that lie on a continent (not an island) and hold no crop yet
//   pick ONE of them uniformly at random  ->  exactly one tile of that crop in the world
//   no candidates?  ->  that crop is simply not generated this time
// Because every pick is uniform over all candidates, a continent with more of a biome
// tends to get more of its crops, and a continent can end up with none.

import { TERRAIN, CROPS } from './map.js';

export const CROP_DEFAULTS = {
  continentMinTiles: 30,    // a landmass this big is a continent; smaller landmasses are islands
};

export function applyCrops(map, rng, opts = {}) {
  const o = { ...CROP_DEFAULTS, ...opts };
  const N = map.size, W = map.cols;
  map.crop.fill(0);

  // ---- continents: connected land of at least continentMinTiles ----
  const nbrs = (i) => map.neighbors(i % W, (i / W) | 0).map(([c, r]) => r * W + c);
  const comp = new Int32Array(N).fill(-1), groups = [];
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0 || !TERRAIN[map.terrain[s]].land) continue;
    const tiles = [s]; comp[s] = groups.length;
    for (let h = 0; h < tiles.length; h++)
      for (const j of nbrs(tiles[h])) if (comp[j] < 0 && TERRAIN[map.terrain[j]].land) { comp[j] = groups.length; tiles.push(j); }
    groups.push(tiles);
  }
  const continents = groups.filter(g => g.length >= o.continentMinTiles);
  const contOf = new Int32Array(N).fill(-1);
  continents.forEach((tiles, k) => tiles.forEach(i => { contOf[i] = k; }));

  // ---- one tile per crop ----
  const result = { placed: 0, total: CROPS.length - 1, missing: [], list: [], perContinent: continents.map(t => ({ size: t.length, count: 0 })) };
  for (const crop of CROPS.slice(1)) {
    const pool = [];
    for (let i = 0; i < N; i++) {
      if (map.biome[i] === crop.biome && contOf[i] >= 0 && !map.crop[i] && TERRAIN[map.terrain[i]].walkable) pool.push(i);
    }
    if (!pool.length) { result.missing.push(crop.name); continue; }   // no such biome on a continent: give up
    const tile = pool[Math.floor(rng() * pool.length)];
    map.crop[tile] = crop.id;
    result.placed++;
    result.perContinent[contOf[tile]].count++;
    result.list.push({ crop: crop.name, tile, continent: contOf[tile] });
  }
  return result;
}
