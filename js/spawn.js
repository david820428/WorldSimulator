// Starting positions for the player civilizations. This is game logic: it only READS the map and
// returns tile numbers, so the world itself is never changed.
//
// A tile may host a civilization when it
//   1. holds a river,
//   2. is not tundra, and
//   3. is not a mountain.
// Civilizations must be MORE than `minDistance` tiles apart (hex steps, wrapping east-west, so the
// far east and far west of the map count as close). Any continent may hold any number of them.
//
// Placement is "farthest first": the first civilization goes on a random valid tile, and every
// next one on the valid tile that is farthest from the ones already placed, as long as that tile
// is far enough away. The whole thing is repeated a few times from different random first tiles and
// the arrangement that fits the most civilizations wins. If the world cannot fit them all, as many
// as fit are placed and the caller reports "N of M".

export const CIV_COUNT = { small: 5, medium: 7, large: 9 };

export const SPAWN_DEFAULTS = {
  minDistance: 7,        // civilizations must be more than this many tiles apart
  restarts: 12,          // tries from different random first tiles
};

const TUNDRA = 8, MOUNTAINS = 4;                 // biome id and terrain id

// Hex steps between two tiles, taking the shorter way round the east-west wrap.
export function hexDistance(map, a, b) {
  const W = map.cols;
  const axial = (col, row) => [col - ((row - (row & 1)) >> 1), row];   // "odd-r" offset -> axial
  const [q1, r1] = axial(a % W, (a / W) | 0);
  let best = Infinity;
  for (const shift of [-W, 0, W]) {
    const [q2, r2] = axial((b % W) + shift, (b / W) | 0);
    const dq = q1 - q2, dr = r1 - r2;
    best = Math.min(best, Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)));
  }
  return best;
}

export function validSpawnTiles(map) {
  const out = [];
  for (let i = 0; i < map.size; i++) {
    if (map.river[i] !== 0 && map.biome[i] !== TUNDRA && map.terrain[i] !== MOUNTAINS) out.push(i);
  }
  return out;
}

// rand: a function returning numbers in [0, 1) (the game's own random generator).
// Returns { tiles, wanted, placed } where tiles are map tile numbers.
export function placeCivilizations(map, wanted, rand, opts = {}) {
  const o = { ...SPAWN_DEFAULTS, ...opts };
  const valid = validSpawnTiles(map);
  let best = [];

  for (let attempt = 0; attempt < o.restarts && best.length < wanted && valid.length; attempt++) {
    const chosen = [valid[Math.floor(rand() * valid.length)]];
    const nearest = valid.map(t => hexDistance(map, t, chosen[0]));   // distance to the closest civilization so far
    while (chosen.length < wanted) {
      let far = o.minDistance, pool = [];                              // must be strictly farther than minDistance
      for (let k = 0; k < valid.length; k++) {
        if (nearest[k] > far) { far = nearest[k]; pool = [valid[k]]; }
        else if (nearest[k] === far && far > o.minDistance) pool.push(valid[k]);
      }
      if (!pool.length) break;                                         // nothing valid is far enough: the world is full
      const next = pool[Math.floor(rand() * pool.length)];             // ties broken at random
      chosen.push(next);
      for (let k = 0; k < valid.length; k++) nearest[k] = Math.min(nearest[k], hexDistance(map, valid[k], next));
    }
    if (chosen.length > best.length) best = chosen;
  }
  return { tiles: best, wanted, placed: best.length };
}
