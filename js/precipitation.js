// Layer 5: precipitation (annual rainfall in mm). Independent of temperature.
//
//   final = max( zonal(lat) × inlandFactor , monsoonFloor ) × mountainFactor
//
// 1. zonal(lat)      latitude bands: wet equator, dry subtropics, wetter mid-latitudes, dry poles
// 2. inlandFactor    drier the further from any ocean tile, but never close to zero
// 3. monsoonFloor    ocean within a few tiles to the EAST guarantees about 1000 mm
// 4. mountainFactor  wind blows rain onto windward slopes and starves the leeward side

export const PRECIPITATION_DEFAULTS = {
  // [|latitude|, mm/year] control points, joined by a smooth monotone curve
  profile: [[0, 2000], [8, 1950], [15, 1250], [20, 600], [25, 280], [28, 220], [32, 300],
            [36, 640], [40, 1000], [48, 950], [55, 800], [62, 550], [70, 280], [80, 150], [90, 100]],

  inlandMin: 0.35,       // far inland keeps at least this share of the zonal rainfall
  inlandScale: 8,        // tiles; how quickly rainfall fades with distance from the sea

  monsoonMm: 1000,       // rainfall floor on a coast that faces ocean to the east
  monsoonReach: 5,       // ocean within this many tiles east gives the full floor
  monsoonFade: 4,        // the floor then fades out over this many extra tiles

  mountainReach: 5,      // a mountain's influence ends this many tiles away
  windwardBoost: 0.8,    // up to +80% right in front of a mountain
  leewardCut: 0.75,      // up to -75% right behind a mountain
  summitBoost: 0.4,      // mountain tiles themselves
  beltEdge: 8,           // degrees over which wind dies out at 30° and 60°

  minMm: 20,             // nothing is ever bone dry
};

// ---- zonal curve: monotone cubic (PCHIP), so no overshoot between control points ----
function makeProfile(points) {
  const x = points.map(p => p[0]), y = points.map(p => p[1]), n = x.length;
  const h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = x[i + 1] - x[i]; d[i] = (y[i + 1] - y[i]) / h[i]; }
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) continue;                     // turning point: flat tangent
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return (lat) => {
    const t = Math.min(90, Math.abs(lat));
    let i = 0; while (i < n - 2 && t > x[i + 1]) i++;
    const s = (t - x[i]) / h[i], s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * y[i] + (s3 - 2 * s2 + s) * h[i] * m[i]
         + (-2 * s3 + 3 * s2) * y[i + 1] + (s3 - s2) * h[i] * m[i + 1];
  };
}

export function zonalPrecipitation(latDeg, p = PRECIPITATION_DEFAULTS) {
  return makeProfile(p.profile)(latDeg);
}

// Prevailing wind at a latitude: sign = direction (+1 blows toward the east),
// size = strength 0..1. Easterly trades below 30°, westerlies 30-60°, polar easterlies above.
// Wind dies out near 30° and 60° (the calm belts), so it never flips abruptly.
export function windAt(latDeg, edge = PRECIPITATION_DEFAULTS.beltEdge) {
  const a = Math.abs(latDeg);
  const dir = (a >= 30 && a < 60) ? 1 : -1;
  const t = Math.min(1, Math.min(Math.abs(a - 30), Math.abs(a - 60)) / edge);
  return dir * t * t * (3 - 2 * t);
}

const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

export function applyPrecipitation(map, opts = {}) {
  const o = { ...PRECIPITATION_DEFAULTS, ...opts };
  const W = map.cols, N = map.size;
  const zonal = makeProfile(o.profile);
  const isLand = (i) => map.terrain[i] >= 2;
  const isMountain = (i) => map.terrain[i] === 4;
  const at = (row, col) => row * W + (((col % W) + W) % W);          // wraps east-west

  // distance (tiles) from the nearest ocean tile, for every tile
  const distSea = new Int16Array(N).fill(-1);
  const queue = [];
  for (let i = 0; i < N; i++) if (!isLand(i)) { distSea[i] = 0; queue.push(i); }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h];
    for (const [c, r] of map.neighbors(i % W, (i / W) | 0)) {
      const j = r * W + c;
      if (distSea[j] < 0) { distSea[j] = distSea[i] + 1; queue.push(j); }
    }
  }

  const rowLat = (row) => 90 - ((row + 0.5) / map.rows) * 180;
  const decay = (d) => Math.max(0, 1 - d / o.mountainReach);          // 1 near, 0 at the reach
  let min = Infinity, max = -Infinity, sum = 0, count = 0;

  for (let row = 0; row < map.rows; row++) {
    const lat = rowLat(row), base = zonal(lat), wind = windAt(lat, o.beltEdge);
    const mag = Math.abs(wind), step = wind >= 0 ? 1 : -1;            // step = downwind direction

    for (let col = 0; col < W; col++) {
      const i = row * W + col;
      if (!isLand(i)) { map.precipitation[i] = base; continue; }      // ocean: placeholder, not used

      // 2. further inland = drier, but never down to zero
      const inland = o.inlandMin + (1 - o.inlandMin) * Math.exp(-(distSea[i] - 1) / o.inlandScale);
      let p = base * inland;

      // 3. monsoon: ocean to the east lifts the floor to about 1000 mm
      let eastDist = 0;
      for (let k = 1; k <= o.monsoonReach + o.monsoonFade; k++) {
        if (!isLand(at(row, col + k))) { eastDist = k; break; }
      }
      if (eastDist) {
        const floor = eastDist <= o.monsoonReach ? o.monsoonMm
          : o.monsoonMm * (1 - smooth((eastDist - o.monsoonReach) / o.monsoonFade));
        p = Math.max(p, floor);
      }

      // 4. mountains and wind
      if (isMountain(i)) {
        p *= 1 + o.summitBoost * mag;
      } else if (mag > 0) {
        for (let k = 1; k < o.mountainReach; k++) {                   // mountain downwind: windward side
          if (isMountain(at(row, col + step * k))) { p *= 1 + o.windwardBoost * mag * decay(k); break; }
        }
        for (let k = 1; k < o.mountainReach; k++) {                   // mountain upwind: leeward rain shadow
          if (isMountain(at(row, col - step * k))) { p *= 1 - o.leewardCut * mag * decay(k); break; }
        }
      }

      p = Math.max(o.minMm, p);
      map.precipitation[i] = p;
      min = Math.min(min, p); max = Math.max(max, p); sum += p; count++;
    }
  }
  return { min, max, mean: sum / count };
}
