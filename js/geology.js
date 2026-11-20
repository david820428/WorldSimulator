// Layer 10: geological resources. The opposite of crops: each resource has several spawn
// locations (3 by default) scattered at random across the world, and where it may spawn
// depends on TERRAIN (lowland / hills / next to mountains / river / coast), not on climate.
//
// For each resource (GEO_RESOURCES in map.js):
//   candidates = walkable land tiles that satisfy its rule and hold no deposit yet
//   pick up to 3 of them uniformly at random (fewer if the world has fewer candidates)
// Rarest resources are placed first (fewest candidates), so common ones cannot use up the
// few tiles that gold or flint need. Picks are purely random, so some continents end up
// rich and others miss a material. Deposits may share a tile with a crop or livestock.

import { TERRAIN, GEO_RESOURCES } from './map.js';

export const GEOLOGY_DEFAULTS = {
  spawnsPerResource: 3,
  continentMinTiles: 30,    // only used for the per-continent report
  continentsOnly: false,    // true = never place on islands
};

const LOWLAND = 2, HILLS = 3, MOUNTAINS = 4;

export function applyGeology(map, rng, opts = {}) {
  const o = { ...GEOLOGY_DEFAULTS, ...opts };
  const N = map.size, W = map.cols, ter = map.terrain;
  map.geo.fill(0);
  const nbrs = (i) => map.neighbors(i % W, (i / W) | 0).map(([c, r]) => r * W + c);

  // ---- continents (for the report, and for continentsOnly) ----
  const comp = new Int32Array(N).fill(-1), groups = [];
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0 || !TERRAIN[ter[s]].land) continue;
    const tiles = [s]; comp[s] = groups.length;
    for (let h = 0; h < tiles.length; h++)
      for (const j of nbrs(tiles[h])) if (comp[j] < 0 && TERRAIN[ter[j]].land) { comp[j] = groups.length; tiles.push(j); }
    groups.push(tiles);
  }
  const continents = groups.filter(g => g.length >= o.continentMinTiles);
  const contOf = new Int32Array(N).fill(-1);
  continents.forEach((tiles, k) => tiles.forEach(i => { contOf[i] = k; }));

  // ---- per-tile terrain facts ----
  const coastal = new Uint8Array(N), nextToMountain = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (ter[i] !== LOWLAND && ter[i] !== HILLS) continue;
    for (const j of nbrs(i)) {
      if (ter[j] <= 1) coastal[i] = 1;               // touches ocean or sea (not a lake)
      if (ter[j] === MOUNTAINS) nextToMountain[i] = 1;
    }
  }
  const fits = (i, r) => (ter[i] === LOWLAND || ter[i] === HILLS)               // never on mountains
    && (!r.terrain || ter[i] === r.terrain)
    && (!r.river || map.river[i] !== 0)
    && (!r.coastal || coastal[i] === 1)
    && (!r.nextToMountain || nextToMountain[i] === 1)
    && (!o.continentsOnly || contOf[i] >= 0);
  const poolOf = (r) => { const p = []; for (let i = 0; i < N; i++) if (!map.geo[i] && fits(i, r)) p.push(i); return p; };

  // ---- place, rarest resource first ----
  const resources = GEO_RESOURCES.slice(1);
  const order = resources.map(r => ({ r, size: poolOf(r.rule).length })).sort((a, b) => a.size - b.size).map(x => x.r);
  const result = { placed: 0, total: resources.length * o.spawnsPerResource, short: [], onIslands: 0,
                   perContinent: continents.map(t => ({ size: t.length, count: 0, kinds: 0 })), list: [] };
  const kindsIn = continents.map(() => new Set());

  for (const res of order) {
    const pool = poolOf(res.rule);
    const take = Math.min(o.spawnsPerResource, pool.length);
    for (let k = 0; k < take; k++) {                      // partial shuffle = random distinct picks
      const j = k + Math.floor(rng() * (pool.length - k));
      [pool[k], pool[j]] = [pool[j], pool[k]];
      const tile = pool[k];
      map.geo[tile] = res.id;
      result.placed++;
      result.list.push({ name: res.name, tile, continent: contOf[tile] });
      if (contOf[tile] >= 0) { result.perContinent[contOf[tile]].count++; kindsIn[contOf[tile]].add(res.id); }
      else result.onIslands++;
    }
    if (take < o.spawnsPerResource) result.short.push(`${res.name} (${take})`);
  }
  result.perContinent.forEach((c, k) => { c.kinds = kindsIn[k].size; });
  return result;
}
