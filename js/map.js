// World data. Pure data, no rendering. Later layers (elevation, climate,
// biomes, resources) become more typed arrays alongside `terrain`.

export const TERRAIN = [
  { id: 0, name: 'Plain', color: '#a8bf86' },
];

// Neighbor offsets for "odd-r" layout (odd rows shoved right by half a hex).
const DIRS = [
  [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]], // even rows
  [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]], // odd rows
];

export class WorldMap {
  constructor(cols = 80, rows = 50) {
    this.cols = cols;
    this.rows = rows;
    this.size = cols * rows;
    this.terrain = new Uint8Array(this.size); // all 0 = Plain
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
