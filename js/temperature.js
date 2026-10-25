// Layer 4: temperature. Latitude first, then a cooling correction for height, then a
// warm-current bonus on high-latitude west coasts. No moisture yet.
// All values are annual mean air temperature in °C.
//
//   T = T_sea_level(lat) - lapse * height + currentWarming(lat, west coast)
import { TERRAIN } from './map.js';

export const TEMPERATURE_DEFAULTS = {
  equator: 27,      // °C at the equator (sea level)
  tropic: 22,       // °C at the Tropics of Cancer / Capricorn
  pole: -25,        // °C at the poles
  tilt: 23.44,      // axial tilt in degrees = latitude of the tropics
  lapse: 6.5,       // °C lost per km of height
  // Representative height (km) of each terrain: deep, shallow, lowland, hills, mountains, lake
  heightKm: [0, 0, 0, 0.6, 2.0, 0],

  // Warm ocean current (Gulf Stream / Kuroshio style) on west coasts at high latitude
  currentWarming: 8,         // °C added on the coast itself
  currentLat: [40, 80],      // |latitude| band where the current acts at full strength
  currentEdge: 5,            // degrees over which it fades in below / out above that band
  currentInland: 3,          // tiles it reaches inland, fading each tile
  currentDeepReach: 3,       // deep ocean must lie within this many tiles beyond the coast
};

const rad = (deg) => deg * Math.PI / 180;

// Sea-level mean temperature at a latitude (degrees, -90..90):
//
//     T(φ) = T_pole + (T_equator - T_pole) · cos(φ)^k
//
// k is not a guess: it is solved so the curve passes through the tropic anchor,
//     k = ln[(T_tropic - T_pole) / (T_equator - T_pole)] / ln cos(tilt)
// With 27 / 22 / -25 this gives k ≈ 1.17.
export function seaLevelTemperature(latDeg, p = TEMPERATURE_DEFAULTS) {
  const k = Math.log((p.tropic - p.pole) / (p.equator - p.pole)) / Math.log(Math.cos(rad(p.tilt)));
  return p.pole + (p.equator - p.pole) * Math.pow(Math.cos(rad(latDeg)), k);
}

// The flat map spans pole to pole: top row is the north pole, bottom row the south pole.
export function latitudeOfRow(row, rows) {
  return 90 - ((row + 0.5) / rows) * 180;
}

const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

export function applyTemperature(map, opts = {}) {
  const p = { ...TEMPERATURE_DEFAULTS, ...opts };
  const W = map.cols;
  const isOcean = (i) => map.terrain[i] <= 1;                 // deep or shallow sea (lakes are not ocean)
  const isLand = (i) => TERRAIN[map.terrain[i]].land;
  const at = (row, c) => row * W + (((c % W) + W) % W);       // wraps east-west
  const rowTemp = new Float32Array(map.rows);
  for (let r = 0; r < map.rows; r++) rowTemp[r] = seaLevelTemperature(latitudeOfRow(r, map.rows), p);

  // How strongly the current acts at each latitude: 1 inside the band, fading at its edges
  const band = new Float32Array(map.rows);
  for (let r = 0; r < map.rows; r++) {
    const a = Math.abs(latitudeOfRow(r, map.rows));
    band[r] = smooth((a - (p.currentLat[0] - p.currentEdge)) / p.currentEdge)
            * (1 - smooth((a - p.currentLat[1]) / p.currentEdge));
  }

  let min = Infinity, max = -Infinity, warmed = 0;
  for (let i = 0; i < map.size; i++) {
    const row = (i / W) | 0, col = i % W;
    let t = rowTemp[row] - p.lapse * p.heightKm[map.terrain[i]];

    if (band[row] > 0 && isLand(i)) {
      // d = how many tiles west to the sea (1 = coast tile). Beyond `currentInland`, no effect.
      let d = 0;
      for (let k = 1; k <= p.currentInland; k++) if (isOcean(at(row, col - k))) { d = k; break; }
      if (d) {
        // Is there DEEP ocean out to the west, past the coastal shelf? Stop at any land.
        let deep = false;
        for (let k = d; k <= d + p.currentDeepReach; k++) {
          const j = at(row, col - k);
          if (!isOcean(j)) break;
          if (map.terrain[j] === 0) { deep = true; break; }
        }
        if (deep) { t += p.currentWarming * band[row] * (1 - (d - 1) / p.currentInland); warmed++; }
      }
    }

    map.temperature[i] = t;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return { min, max, warmed };
}
