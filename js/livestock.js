// Layer 9: livestock (domestic animals). Exactly the same rule as crops: each animal type
// is placed on ONE random walkable continent tile of its own biome, or skipped if that biome
// is missing. Livestock is a separate layer, so it may share a tile with a crop.

import { LIVESTOCK } from './map.js';
import { placeOnePerType } from './crops.js';

export function applyLivestock(map, rng, opts = {}) {
  return placeOnePerType(map, rng, LIVESTOCK.slice(1), map.livestock, opts);
}
