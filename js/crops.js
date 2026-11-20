// Layer 8: crop resources. Crops come from biomes only (never from elevation or latitude).
// Livestock (livestock.js) reuses the same placement routine.
//
// For each resource type (CROPS in map.js):
//   candidates = walkable land tiles (lowland or hills, never impassable mountains) of the
//                type's own biome that lie on a continent (not an island) and do not already
//                hold a resource OF THE SAME KIND (a crop and a livestock may share a tile)
//   pick ONE of them uniformly at random  ->  exactly one tile of that type in the world
//   no candidates?  ->  that type is simply not generated this time
// Because every pick is uniform over all candidates, a continent with more of a biome
// tends to get more of its resources, and a continent can end up with none.

import { TERRAIN, CROPS } from './map.js';

export const CROP_DEFAULTS = {
  continentMinTiles: 30,    // a landmass this big is a continent; smaller landmasses are islands
};

// items: [{ name, biome, id }]; target: the per-tile array that receives the ids
export function placeOnePerType(map, rng, items, target, opts = {}) {
  const o = { ...CROP_DEFAULTS, ...opts };
  const N = map.size, W = map.cols;
  target.fill(0);

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

  // ---- one tile per type ----
  const result = { placed: 0, total: items.length, missing: [], list: [], perContinent: continents.map(t => ({ size: t.length, count: 0 })) };
  for (const item of items) {
    const pool = [];
    for (let i = 0; i < N; i++) {
      if (map.biome[i] === item.biome && contOf[i] >= 0 && !target[i] && TERRAIN[map.terrain[i]].walkable) pool.push(i);
    }
    if (!pool.length) { result.missing.push(item.name); continue; }   // no such biome on a continent: give up
    const tile = pool[Math.floor(rng() * pool.length)];
    target[tile] = item.id;
    result.placed++;
    result.perContinent[contOf[tile]].count++;
    result.list.push({ name: item.name, tile, continent: contOf[tile] });
  }
  return result;
}

export function applyCrops(map, rng, opts = {}) {
  return placeOnePerType(map, rng, CROPS.slice(1), map.crop, opts);
}
