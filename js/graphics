// Graphic layer: draws the finished world as a muted, map-like illustration.
//
// It only READS the map data (terrain, biome, rivers, volcanoes, resources) and never changes
// it, so it cannot interfere with world generation. Everything is vector-drawn in code
// (no image files), and all the randomness is a hash of tile numbers, not the world's random
// stream, so a tile always looks the same.
//
// Two edge styles:
//   'hard'     plain hex tiles with a thin outline
//   'organic'  wobbly tile edges shared exactly between neighbours (so no gaps), a stippled and
//              banded blend where two biomes meet, and a pale shallow rim along coasts
//
// Layers, drawn in this order:  ground -> border blending -> relief and plants ->
//                               rivers -> volcano and resource badges
// Detail fades in with zoom (LOD) so a zoomed-out map stays cheap to draw.

const SQRT3 = Math.sqrt(3), TAU = Math.PI * 2;

// Zoom levels at which each kind of detail appears.
const LOD = { rivers: 0.15, relief: 0.2, rim: 0.25, band: 0.35, badges: 0.45, deco: 0.7, dots: 0.9 };

const CORNER_JITTER = 0.055, EDGE_JITTER = 0.075, DOTS_PER_EDGE = 12;

// Corner i of a pointy-top hex: 0 top, 1 top-right, 2 bottom-right, 3 bottom, 4 bottom-left, 5 top-left.
// Edge i joins corner i to corner i+1 and faces map direction EDGE_DIR[i] (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE).
const EDGE_DIR = [1, 0, 5, 4, 3, 2];
const CORNER = [0, 1, 2, 3, 4, 5].map(i => [Math.cos((60 * i - 90) * Math.PI / 180), Math.sin((60 * i - 90) * Math.PI / 180)]);
// Vector from a tile centre to each neighbour, in hex radii (E, NE, NW, W, SW, SE)
const TO_NEIGHBOUR = [[SQRT3, 0], [SQRT3 / 2, -1.5], [-SQRT3 / 2, -1.5], [-SQRT3, 0], [-SQRT3 / 2, 1.5], [SQRT3 / 2, 1.5]];

// ---- palette (muted) ----------------------------------------------------------------
const rgb = (h) => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
const mix = (a, b, t) => {
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
};

// Ground classes: 1..8 = biome ids, 10 = lake, 11 = shallow sea, 12 = deep ocean
const GROUND = { 1: '#6f8f6a', 2: '#b9b27a', 3: '#d8c28f', 4: '#8fa386', 5: '#aebc88', 6: '#cdbb98',
                 7: '#6f8a7c', 8: '#c4cdc6', 10: '#8fb0b5', 11: '#9ab6bd', 12: '#7f9eab' };
const PAL = {};
for (const k in GROUND) {
  const g = GROUND[k], mtn = mix(g, '#9b978d', 0.7);
  PAL[k] = { fill: g, line: mix(g, '#3f4a3a', 0.4), hillLight: mix(g, '#ffffff', 0.14),
             hillShade: mix(g, '#27352a', 0.3), mtn, mtnShade: mix(mtn, '#262626', 0.28) };
}
const SNOWY = new Set([4, 5, 7, 8]);                           // biomes whose mountains get a pale cap
const DECO = { 1: { fill: '#4e6c4e' }, 4: { fill: '#5c7655' }, 7: { fill: '#46675a' },
               2: { fill: '#7f8a52', line: '#8a8450' }, 5: { line: '#8a9f6a' }, 3: { line: '#bfa878' },
               6: { line: '#b7a888' }, 8: { line: '#a3afa8' }, 10: { line: '#bcd2d6' },
               11: { line: '#c6d8dc' }, 12: { line: '#94b2bd' } };

// ---- deterministic hash random (never touches the world's random stream) --------------
function rnd(a, b, c, k) {
  let h = Math.imul(a + 1, 73856093) ^ Math.imul(b + 2, 19349663) ^ Math.imul(c + 3, 83492791) ^ Math.imul(k + 7, 2654435761);
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class MapArt {
  constructor(map, size) {
    this.map = map;
    this.s = size;
    const s = size;
    this.hex = new Path2D();                                   // regular hex, shared by all hard tiles
    CORNER.forEach(([x, y], i) => (i ? this.hex.lineTo(x * s, y * s) : this.hex.moveTo(x * s, y * s)));
    this.hex.closePath();

    const poly = (pts) => { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x * s, y * s) : p.moveTo(x * s, y * s))); p.closePath(); return p; };
    this.hillBase = new Path2D();                              // rounded mound
    this.hillBase.moveTo(-0.73 * s, 0.36 * s);
    this.hillBase.bezierCurveTo(-0.55 * s, -0.36 * s, -0.09 * s, -0.45 * s, 0.09 * s, -0.05 * s);
    this.hillBase.bezierCurveTo(0.27 * s, -0.41 * s, 0.68 * s, -0.27 * s, 0.77 * s, 0.36 * s);
    this.hillBase.quadraticCurveTo(0.05 * s, 0.64 * s, -0.73 * s, 0.36 * s);
    this.hillShade = new Path2D();
    this.hillShade.moveTo(0.09 * s, -0.05 * s);
    this.hillShade.bezierCurveTo(0.27 * s, -0.41 * s, 0.68 * s, -0.27 * s, 0.77 * s, 0.36 * s);
    this.hillShade.quadraticCurveTo(0.5 * s, 0.48 * s, 0.27 * s, 0.48 * s);
    this.hillShade.bezierCurveTo(0.41 * s, 0.14 * s, 0.32 * s, 0, 0.09 * s, -0.05 * s);
    this.mtn = poly([[-0.82, 0.55], [-0.27, -0.55], [0.05, -0.05], [0.32, -0.64], [0.86, 0.55]]);
    this.mtnShade = poly([[0.32, -0.64], [0.86, 0.55], [0.36, 0.55], [0.23, -0.09]]);
    this.snow = poly([[-0.27, -0.55], [-0.11, -0.27], [-0.2, -0.32], [-0.27, -0.2], [-0.34, -0.32], [-0.43, -0.27]]);
    this.snow.addPath(poly([[0.32, -0.64], [0.48, -0.34], [0.39, -0.39], [0.32, -0.27], [0.25, -0.39], [0.16, -0.34]]));
    this.cone = poly([[-0.6, 0.5], [-0.2, -0.4], [0.2, -0.4], [0.6, 0.5]]);
    this.lava = poly([[-0.2, -0.4], [0.2, -0.4], [0.32, -0.18], [-0.32, -0.18]]);

    this.cap = 0;
    this.rebuild();
  }

  // Call after a new world has been generated: forgets everything drawn for the old one.
  rebuild() {
    const map = this.map, N = map.size;
    this.shapes = new Array(N);
    this.decos = new Array(N);
    this.rivers = new Array(N);
    this.flow = new Uint8Array(N);                             // river size: tiles upstream + 1
    this.riverIn = new Map();                                  // tile -> tiles whose river flows into it
    for (let i = 0; i < N; i++) {
      if (!map.river[i]) continue;
      this.flow[i] += 1;
      for (let j = map.riverTo[i], guard = 0; j >= 0 && guard < 60; j = map.riverTo[j], guard++) this.flow[j] += 1;
      if (map.riverTo[i] >= 0) {
        const list = this.riverIn.get(map.riverTo[i]);
        if (list) list.push(i); else this.riverIn.set(map.riverTo[i], [i]);
      }
    }
  }

  classOf(i) {
    const t = this.map.terrain[i];
    return t === 0 ? 12 : t === 1 ? 11 : t === 5 ? 10 : this.map.biome[i];
  }

  // ---- per-tile geometry, built the first time a tile is drawn ---------------------------
  // Wobbly outline. Corner wobble is keyed by the three tiles meeting at the corner, and edge
  // wobble by the two tiles sharing the edge, so neighbours draw the identical edge.
  shape(idx) {
    let sh = this.shapes[idx];
    if (sh) return sh;
    const map = this.map, s = this.s, col = idx % map.cols, row = (idx / map.cols) | 0;
    const nb = EDGE_DIR.map(d => map.step(col, row, d));
    const P = CORNER.map(([x, y], i) => {
      const [k1, k2, k3] = [idx, nb[(i + 5) % 6], nb[i]].sort((a, b) => a - b);
      return [(x + (rnd(k1, k2, k3, 0) - 0.5) * 2 * CORNER_JITTER) * s, (y + (rnd(k1, k2, k3, 1) - 0.5) * 2 * CORNER_JITTER) * s];
    });
    const path = new Path2D(), fx = [], ca = this.classOf(idx);
    let first = true;
    const add = (x, y) => { if (first) { path.moveTo(x, y); first = false; } else path.lineTo(x, y); };
    for (let i = 0; i < 6; i++) {
      const A = P[i], B = P[(i + 1) % 6], u = nb[i];
      const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy), nx = dy / len, ny = -dx / len;   // outward normal
      const lo = u < 0 ? idx : Math.min(idx, u), hi = u < 0 ? -1 : Math.max(idx, u), salt = u < 0 ? i : 0;
      const a = (rnd(lo, hi, salt, 2) - 0.5) * 2 * EDGE_JITTER * s, b = (rnd(lo, hi, salt, 3) - 0.5) * 2 * EDGE_JITTER * s;
      const [o1, o2] = (u < 0 || idx < u) ? [a, b] : [-b, -a];   // the other tile sees the edge reversed
      const p1 = [A[0] + dx / 3 + nx * o1, A[1] + dy / 3 + ny * o1], p2 = [A[0] + 2 * dx / 3 + nx * o2, A[1] + 2 * dy / 3 + ny * o2];
      add(A[0], A[1]); add(p1[0], p1[1]); add(p2[0], p2[1]);
      if (u > idx) {                                             // the lower-numbered tile owns the border effect
        const cb = this.classOf(u);
        if (ca !== cb) fx.push(this.borderFx(idx, u, ca, cb, [A, p1, p2, B], nx, ny, i));
      }
    }
    path.closePath();
    return (this.shapes[idx] = { path, fx });
  }

  borderFx(idx, u, ca, cb, pts, nx, ny, i) {
    const s = this.s, isLand = (c) => c <= 8;
    const kind = isLand(ca) && isLand(cb) ? 'blend'
      : (isLand(ca) !== isLand(cb)) ? ((ca === 10 || cb === 10) ? 'shore' : 'coast') : 'shelf';
    const fx = { kind, p: [].concat(...pts), band: mix(mix(GROUND[ca], GROUND[cb], 0.5), '#6b6a4a', 0.12), dotsA: null, dotsB: null, colA: GROUND[ca], colB: GROUND[cb] };
    if (kind === 'blend') {
      // specks of each biome drifting across the border into the other
      const A = [], B = [];
      for (let d = 0; d < DOTS_PER_EDGE; d++) {
        const t = rnd(idx, u, i, 10 + d * 3) * 3, seg = Math.min(2, Math.floor(t)), f = t - seg;
        const px = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * f, py = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * f;
        const off = (0.05 + 0.2 * rnd(idx, u, i, 11 + d * 3)) * s, side = rnd(idx, u, i, 12 + d * 3) < 0.5 ? -1 : 1;
        const r = (0.025 + 0.027 * rnd(idx, u, i, 13 + d * 3)) * s;
        (side > 0 ? A : B).push(px + nx * off * side, py + ny * off * side, r);
      }
      fx.dotsA = A; fx.dotsB = B;                                // A: in the neighbour's area, coloured like this tile
    }
    return fx;
  }

  // Trees, grass, dunes or waves, as two cached paths (one filled, one stroked).
  deco(idx) {
    let d = this.decos[idx];
    if (d !== undefined) return d;
    const map = this.map, s = this.s, c = this.classOf(idx), t = map.terrain[idx];
    const spec = DECO[c];
    if (!spec || t === 4) return (this.decos[idx] = null);
    const r = (k) => rnd(idx, c, 11, k), hills = t === 3;
    const pos = (j) => hills ? [(r(j * 2) - 0.5) * 1.0 * s, (-0.42 + 0.5 * r(j * 2 + 1)) * s]
      : [Math.cos(r(j * 2) * TAU) * Math.sqrt(r(j * 2 + 1)) * 0.62 * s, Math.sin(r(j * 2) * TAU) * Math.sqrt(r(j * 2 + 1)) * 0.62 * s];
    const count = (n) => hills ? Math.max(2, Math.round(n * 0.6)) : n;
    const fill = new Path2D(), line = new Path2D();
    const wave = (x, y, w) => { line.moveTo(x, y); line.quadraticCurveTo(x + w * 0.25, y - w * 0.18, x + w * 0.5, y); line.quadraticCurveTo(x + w * 0.75, y + w * 0.18, x + w, y); };
    if (c === 1 || c === 4) {                                    // round tree crowns
      for (let j = 0, n = count(c === 1 ? 7 : 5); j < n; j++) { const [x, y] = pos(j), rad = (0.1 + 0.05 * r(40 + j)) * s; fill.moveTo(x + rad, y); fill.arc(x, y, rad, 0, TAU); }
    } else if (c === 7) {                                        // conifers
      for (let j = 0, n = count(6); j < n; j++) { const [x, y] = pos(j); fill.moveTo(x, y - 0.17 * s); fill.lineTo(x - 0.09 * s, y + 0.1 * s); fill.lineTo(x + 0.09 * s, y + 0.1 * s); fill.closePath(); }
    } else if (c === 2) {                                        // acacia and tufts
      for (let j = 0, n = count(3); j < n; j++) { const [x, y] = pos(j); fill.moveTo(x + 0.16 * s, y); fill.ellipse(x, y, 0.16 * s, 0.06 * s, 0, 0, TAU); line.moveTo(x, y + 0.04 * s); line.lineTo(x, y + 0.16 * s); }
      for (let j = 0, n = count(4); j < n; j++) { const [x, y] = pos(10 + j); line.moveTo(x - 0.06 * s, y + 0.05 * s); line.lineTo(x, y - 0.06 * s); line.lineTo(x + 0.06 * s, y + 0.05 * s); }
    } else if (c === 5) {                                        // grass tufts
      for (let j = 0, n = count(7); j < n; j++) { const [x, y] = pos(j); for (const dx of [-0.07, 0, 0.07]) { line.moveTo(x, y + 0.05 * s); line.lineTo(x + dx * s, y - 0.07 * s); } }
    } else if (c === 3 || c === 6) {                             // dunes
      for (let j = 0, n = count(3); j < n; j++) { const [x, y] = pos(j); wave(x - 0.24 * s, y, 0.48 * s); }
    } else if (c === 8) {                                        // lichen dashes
      for (let j = 0, n = count(6); j < n; j++) { const [x, y] = pos(j); line.moveTo(x - 0.05 * s, y); line.lineTo(x + 0.05 * s, y); }
    } else {                                                     // water: wave ticks
      const n = c === 10 ? 1 : 2;
      for (let j = 0; j < n; j++) wave((-0.34 + 0.3 * r(j * 2)) * s, (-0.3 + 0.55 * r(j * 2 + 1)) * s, (c === 12 ? 0.5 : 0.4) * s);
    }
    return (this.decos[idx] = { fill, line, fc: spec.fill, lc: spec.line });
  }

  // River pieces in tile-local coordinates: curves entering from each upstream edge (or a short
  // source stub) through the centre and out toward the next tile, or toward the sea at the mouth.
  riverGeom(idx) {
    let g = this.rivers[idx];
    if (g) return g;
    const map = this.map, s = this.s, col = idx % map.cols, row = (idx / map.cols) | 0;
    const dirTo = (u) => { for (let k = 0; k < 6; k++) if (map.step(col, row, k) === u) return TO_NEIGHBOUR[k]; return null; };
    let out = null;
    if (map.riverTo[idx] >= 0) out = dirTo(map.riverTo[idx]);
    else for (let k = 0; k < 6 && !out; k++) { const n = map.step(col, row, k); if (n >= 0 && map.terrain[n] <= 1) out = TO_NEIGHBOUR[k]; }
    if (!out) out = [0, 0.5];
    const ex = out[0] * 0.5 * s, ey = out[1] * 0.5 * s;
    g = [];
    for (const u of this.riverIn.get(idx) || []) { const v = dirTo(u); if (v) g.push(v[0] * 0.5 * s, v[1] * 0.5 * s, 0, 0, ex, ey); }
    if (!g.length) g.push(-ex * 0.45, -ey * 0.45, 0, 0, ex, ey);       // a source starts a little inside the tile
    return (this.rivers[idx] = g);
  }

  ensure(n) {
    if (this.cap >= n) return;
    this.cap = n + 256;
    this.vIdx = new Int32Array(this.cap); this.vX = new Float32Array(this.cap); this.vY = new Float32Array(this.cap);
  }

  // ---- drawing ------------------------------------------------------------------------------
  // r is the Renderer (camera and view size). r0..r1 rows and c0..c1 (unwrapped) columns are visible.
  draw(ctx, r, r0, r1, c0, c1, style) {
    const map = this.map, s = this.s, cam = r.cam, z = cam.zoom, dpr = r.dpr;
    const k = dpr * z, tx = dpr * (r.viewW / 2 - cam.x * z), ty = dpr * (r.viewH / 2 - cam.y * z);
    const organic = style === 'organic', hexW = r.hexW, rowH = 1.5 * s;

    this.ensure((r1 - r0 + 1) * (c1 - c0 + 1));
    let n = 0;
    for (let row = r0; row <= r1; row++) {
      for (let c = c0; c <= c1; c++, n++) {
        this.vIdx[n] = map.index(c, row);
        this.vX[n] = hexW * (c + 0.5 * (row & 1));
        this.vY[n] = rowH * row;
      }
    }
    const at = (i) => ctx.setTransform(k, 0, 0, k, tx + this.vX[i] * k, ty + this.vY[i] * k);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // 1. ground
    ctx.lineWidth = 1 / z;
    for (let i = 0; i < n; i++) {
      const idx = this.vIdx[i], pal = PAL[this.classOf(idx)];
      at(i);
      ctx.fillStyle = pal.fill;
      const path = organic ? this.shape(idx).path : this.hex;
      ctx.fill(path);
      ctx.strokeStyle = organic || z <= 0.35 ? pal.fill : pal.line;   // organic: the stroke hides hairline seams
      ctx.stroke(path);
    }

    // 2. border blending (organic only)
    if (organic && z >= LOD.rim) {
      for (let i = 0; i < n; i++) {
        const fxs = this.shape(this.vIdx[i]).fx;
        if (!fxs.length) continue;
        at(i);
        for (const e of fxs) {
          const water = e.kind === 'coast' || e.kind === 'shore';
          if (!water && z < LOD.band) continue;
          ctx.beginPath(); ctx.moveTo(e.p[0], e.p[1]);
          for (let j = 2; j < 8; j += 2) ctx.lineTo(e.p[j], e.p[j + 1]);
          if (e.kind === 'coast' || e.kind === 'shore') {
            ctx.globalAlpha = 0.65; ctx.strokeStyle = e.kind === 'coast' ? '#c9dcd9' : '#bcd3d4';
            ctx.lineWidth = (e.kind === 'coast' ? 0.26 : 0.18) * s; ctx.stroke();
            ctx.globalAlpha = 1; ctx.strokeStyle = '#7a948f'; ctx.lineWidth = 0.035 * s; ctx.stroke();
          } else {
            ctx.globalAlpha = 0.5; ctx.strokeStyle = e.band; ctx.lineWidth = 0.3 * s; ctx.stroke(); ctx.globalAlpha = 1;
            if (e.dotsA && z >= LOD.dots) {
              ctx.fillStyle = e.colA; ctx.beginPath();
              for (let j = 0; j < e.dotsA.length; j += 3) { ctx.moveTo(e.dotsA[j] + e.dotsA[j + 2], e.dotsA[j + 1]); ctx.arc(e.dotsA[j], e.dotsA[j + 1], e.dotsA[j + 2], 0, TAU); }
              ctx.fill();
              ctx.fillStyle = e.colB; ctx.beginPath();
              for (let j = 0; j < e.dotsB.length; j += 3) { ctx.moveTo(e.dotsB[j] + e.dotsB[j + 2], e.dotsB[j + 1]); ctx.arc(e.dotsB[j], e.dotsB[j + 1], e.dotsB[j + 2], 0, TAU); }
              ctx.fill();
            }
          }
        }
      }
    }

    // 3. relief (hills, mountains) and plants / dunes / waves
    for (let i = 0; i < n; i++) {
      const idx = this.vIdx[i], t = map.terrain[idx], showRelief = z >= LOD.relief && (t === 3 || t === 4), showDeco = z >= LOD.deco;
      if (!showRelief && !showDeco) continue;
      const cls = this.classOf(idx), pal = PAL[cls];
      at(i);
      if (showRelief) {
        ctx.lineWidth = 0.03 * s; ctx.strokeStyle = pal.line;
        if (t === 3) {
          ctx.fillStyle = pal.hillLight; ctx.fill(this.hillBase); ctx.stroke(this.hillBase);
          ctx.fillStyle = pal.hillShade; ctx.fill(this.hillShade);
        } else {
          ctx.fillStyle = pal.mtn; ctx.fill(this.mtn); ctx.stroke(this.mtn);
          ctx.fillStyle = pal.mtnShade; ctx.fill(this.mtnShade);
          if (SNOWY.has(cls)) { ctx.fillStyle = '#ebe8df'; ctx.fill(this.snow); }
        }
      }
      if (showDeco) {
        const d = this.deco(idx);
        if (d) {
          if (d.fc) { ctx.fillStyle = d.fc; ctx.fill(d.fill); }
          if (d.lc) { ctx.strokeStyle = d.lc; ctx.lineWidth = 0.045 * s; ctx.stroke(d.line); }
        }
      }
    }

    // 4. rivers: pale edge first, then the blue stream, wider downstream
    if (z >= LOD.rivers) {
      for (let i = 0; i < n; i++) {
        const idx = this.vIdx[i];
        if (!map.river[idx]) continue;
        at(i);
        const g = this.riverGeom(idx), w = (0.07 + 0.018 * Math.min(this.flow[idx], 7)) * s;
        ctx.beginPath();
        for (let j = 0; j < g.length; j += 6) { ctx.moveTo(g[j], g[j + 1]); ctx.quadraticCurveTo(g[j + 2], g[j + 3], g[j + 4], g[j + 5]); }
        ctx.globalAlpha = 0.6; ctx.strokeStyle = '#eef0e8'; ctx.lineWidth = w * 1.9; ctx.stroke();
        ctx.globalAlpha = 1; ctx.strokeStyle = '#7aa6b8'; ctx.lineWidth = w; ctx.stroke();
      }
    }

    // 5. volcano, then resource badges
    for (let i = 0; i < n; i++) {
      const idx = this.vIdx[i], volcano = map.feature[idx] === 1;
      const kinds = z >= LOD.badges ? this.badgeKinds(idx) : null;
      if (!volcano && !kinds) continue;
      at(i);
      if (volcano) {
        ctx.save(); ctx.translate(0.05 * s, 0.1 * s); ctx.scale(0.85, 0.85);
        ctx.fillStyle = '#625750'; ctx.fill(this.cone); ctx.lineWidth = 0.03 * s; ctx.strokeStyle = '#463d38'; ctx.stroke(this.cone);
        ctx.fillStyle = '#c8744a'; ctx.fill(this.lava);
        ctx.restore();
      }
      if (kinds) this.badges(ctx, kinds, volcano || map.river[idx] !== 0);
    }

    ctx.setTransform(k, 0, 0, k, tx, ty);                        // hand the world transform back to the renderer
  }

  badgeKinds(idx) {
    const m = this.map, kinds = [];
    if (m.crop[idx]) kinds.push('crop');
    if (m.livestock[idx]) kinds.push('livestock');
    if (m.geo[idx]) kinds.push('geo');
    return kinds.length ? kinds : null;
  }

  // Up to three round badges: corners around a river/volcano, otherwise spread over a bare tile.
  badges(ctx, kinds, hasBase) {
    const slots = hasBase ? [[0.40, 0.40, 0.58], [-0.40, 0.40, 0.58], [0.38, -0.38, 0.58]]
      : kinds.length === 1 ? [[0, 0, 1]]
      : kinds.length === 2 ? [[-0.34, 0, 0.72], [0.34, 0, 0.72]]
      : [[0, -0.30, 0.62], [-0.36, 0.28, 0.62], [0.36, 0.28, 0.62]];
    kinds.forEach((kind, k) => this.badge(ctx, kind, ...slots[k]));
  }

  badge(ctx, kind, dx, dy, sc) {
    const s = this.s;
    ctx.save();
    ctx.translate(dx * s, dy * s); ctx.scale(sc, sc);
    ctx.beginPath(); ctx.arc(0, 0, 0.46 * s, 0, TAU);
    ctx.fillStyle = kind === 'crop' ? '#f1ead2' : kind === 'livestock' ? '#e4ebf1' : '#e6e3ea'; ctx.fill();
    ctx.lineWidth = 0.04 * s; ctx.strokeStyle = 'rgba(110, 95, 60, 0.7)'; ctx.stroke();
    if (kind === 'crop') {
      ctx.beginPath(); ctx.moveTo(0, 0.34 * s); ctx.lineTo(0, -0.28 * s);
      ctx.lineWidth = 0.06 * s; ctx.strokeStyle = '#8a7436'; ctx.stroke();
      ctx.fillStyle = '#cfae52'; ctx.lineWidth = 0.025 * s;
      for (const y of [-0.16, 0.02, 0.2]) for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(side * 0.11 * s, (y - 0.02) * s, 0.06 * s, 0.12 * s, side * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.ellipse(0, -0.33 * s, 0.06 * s, 0.11 * s, 0, 0, TAU); ctx.fill(); ctx.stroke();
    } else if (kind === 'geo') {
      ctx.beginPath(); ctx.moveTo(-0.24 * s, 0.32 * s); ctx.lineTo(0.19 * s, -0.27 * s);
      ctx.lineWidth = 0.07 * s; ctx.strokeStyle = '#7a6648'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.14 * s, -0.3 * s); ctx.quadraticCurveTo(0.26 * s, -0.42 * s, 0.36 * s, 0.04 * s);
      ctx.lineWidth = 0.1 * s; ctx.strokeStyle = '#626a73'; ctx.stroke();
    } else {
      ctx.fillStyle = '#6b5444';
      ctx.beginPath(); ctx.ellipse(0, 0.13 * s, 0.2 * s, 0.16 * s, 0, 0, TAU); ctx.fill();
      for (const [x, y, rot] of [[-0.25, -0.08, -0.45], [-0.09, -0.25, -0.15], [0.09, -0.25, 0.15], [0.25, -0.08, 0.45]]) {
        ctx.beginPath(); ctx.ellipse(x * s, y * s, 0.075 * s, 0.1 * s, rot, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }
}
