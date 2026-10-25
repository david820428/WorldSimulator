// World data. Pure data, no rendering. Later layers (elevation, climate,
// biomes, resources) become more typed arrays alongside `terrain`.

// Order matters: terrain ids are stored in map.terrain.
// `sailable` is for early-game ships; deep ocean opens up with later technology.
export const TERRAIN = [
  { id: 0, name: 'Deep ocean',  color: '#1d4a6e', land: false, walkable: false, sailable: false },
  { id: 1, name: 'Shallow sea', color: '#3d8bb0', land: false, walkable: false, sailable: true  },
  { id: 2, name: 'Lowland',     color: '#a8bf86', land: true,  walkable: true,  sailable: false },
  { id: 3, name: 'Hills',       color: '#c2ae6c', land: true,  walkable: true,  sailable: false },
  { id: 4, name: 'Mountains',   color: '#837f7a', land: true,  walkable: false, sailable: false },
];

// Neighbor offsets for "odd-r" layout (odd rows shoved right by half a hex).
const DIRS = [
  [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]], // even rows
  [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]], // odd rows
];

// Features sit on top of terrain (a volcano on a plain is still a plain).
export const FEATURES = [
  { id: 0, name: 'None' },
  { id: 1, name: 'Volcano' },
];

export class WorldMap {
  constructor(cols = 80, rows = 50) {
    this.cols = cols;
    this.rows = rows;
    this.size = cols * rows;
    this.terrain = new Uint8Array(this.size); // index into TERRAIN
    this.plate = new Uint8Array(this.size);   // plate id per tile (set by worldgen)
    this.plates = [];                         // plate descriptions (set by worldgen)
    this.temperature = new Float32Array(this.size); // annual mean °C
    this.precipitation = new Float32Array(this.size); // annual mm (land tiles)
    this.feature = new Uint8Array(this.size); // index into FEATURES
    this.volcanic = new Float32Array(this.size); // volcanic potential near plate borders (0..1)
    this.uplift = new Float32Array(this.size); // mountain-building strength from plate collisions
    this.field = new Float32Array(this.size); // raw height-like value, reused for elevation later
  }

  index(col, row) { return row * this.cols + this.wrapCol(col); }

  // Columns wrap east-west; rows do not wrap.
  wrapCol(col) { return ((col % this.cols) + this.cols) % this.cols; }

  inBounds(row) { return row >= 0 && row < this.rows; }

  neighbors(col, row) {
    const out = [];
    for (const [dc, dr] of DIRS[row & 1]) {
      const r = row + dr;
      if (this.inBounds(r)) out.push([this.wrapCol(col + dc), r]);
    }
    return out;
  }
}
