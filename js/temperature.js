// Layer 4: temperature. Latitude first, then a cooling correction for height.
// No moisture, no ocean currents yet. All values are annual mean air temperature in °C.

export const TEMPERATURE_DEFAULTS = {
  equator: 27,      // °C at the equator (sea level)
  tropic: 22,       // °C at the Tropics of Cancer / Capricorn
  pole: -25,        // °C at the poles
  tilt: 23.44,      // axial tilt in degrees = latitude of the tropics
  lapse: 6.5,       // °C lost per km of height
  // Representative height (km) of each terrain: deep, shallow, lowland, hills, mountains, lake
  heightKm: [0, 0, 0, 0.6, 2.0, 0],
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

export function applyTemperature(map, opts = {}) {
  const p = { ...TEMPERATURE_DEFAULTS, ...opts };
  const rowTemp = new Float32Array(map.rows);
  for (let r = 0; r < map.rows; r++) rowTemp[r] = seaLevelTemperature(latitudeOfRow(r, map.rows), p);

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < map.size; i++) {
    const t = rowTemp[(i / map.cols) | 0] - p.lapse * p.heightKm[map.terrain[i]];
    map.temperature[i] = t;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return { min, max };
}
