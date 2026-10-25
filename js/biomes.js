// Layer 6: biomes. Decided ONLY by a land tile's temperature and precipitation.
// Latitude and elevation do not matter directly (they already shaped those two values).
//
//   temperature  >  21        tropical   rainforest > 1500 | savannah 300..1500 | desert < 300
//   5 .. 21                   temperate  forest > 800      | grassland 300..800 | desert < 300
//   -11 .. 5                  frigid     boreal forest (any rainfall)
//   <= -11                    arctic     tundra (any rainfall)

export const BIOME_DEFAULTS = {
  tropicalAbove: 21,     // °C
  temperateAbove: 5,
  frigidAbove: -11,

  desertBelow: 300,      // mm; used by both tropical and temperate zones
  rainforestAbove: 1500, // mm; tropical
  forestAbove: 800,      // mm; temperate
};

// biome ids (see BIOMES in map.js); 0 means "no biome" (ocean, sea, lakes)
const RAINFOREST = 1, SAVANNAH = 2, TROPICAL_DESERT = 3,
      FOREST = 4, GRASSLAND = 5, TEMPERATE_DESERT = 6, BOREAL = 7, TUNDRA = 8;

export function biomeFor(temp, rain, o = BIOME_DEFAULTS) {
  if (temp > o.tropicalAbove) {
    return rain > o.rainforestAbove ? RAINFOREST : rain >= o.desertBelow ? SAVANNAH : TROPICAL_DESERT;
  }
  if (temp > o.temperateAbove) {
    return rain > o.forestAbove ? FOREST : rain >= o.desertBelow ? GRASSLAND : TEMPERATE_DESERT;
  }
  if (temp > o.frigidAbove) return BOREAL;
  return TUNDRA;
}

// Fills map.biome and returns the number of tiles of each biome.
export function applyBiomes(map, opts = {}, landIds = [2, 3, 4]) {
  const o = { ...BIOME_DEFAULTS, ...opts };
  const counts = new Array(9).fill(0);
  for (let i = 0; i < map.size; i++) {
    const b = landIds.includes(map.terrain[i])             // lowland, hills, mountains only
      ? biomeFor(map.temperature[i], map.precipitation[i], o) : 0;
    map.biome[i] = b;
    counts[b]++;
  }
  return counts;
}
