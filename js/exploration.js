// Exploration prototype (always in exploration mode, no economy yet). Like the rest of the game
// logic it only READS the map; ownership lives here, in the game, so the world is never touched.
//
// Every round each civilization receives `income` points into a bank. It then automatically buys
// the cheapest tile on its frontier (an unowned, explorable tile next to its territory) while the
// bank can pay for it; points that cannot buy anything yet keep accumulating. Tiles are exclusive:
// the first civilization to buy a tile owns it. Civilizations take turns buying ONE tile at a time
// in an order shuffled every round, so a contested tile goes to a random one of them.
//
// Cost of a tile = (base cost of its terrain - 5 if it has a river + 5 if it is tropical rainforest)
//                  x 1.2 ^ (hex distance from that civilization's spawn tile), rounded to 3 decimals.
// Mountains and deep ocean cannot be explored yet. When two territories touch, an information
// event "have met" is reported (once per pair); everybody keeps expanding wherever frontier remains.

import { hexDistance } from './spawn.js';
import { hashSeed } from './random.js';

export const EXPLORE_DEFAULTS = {
  income: 10,                                  // exploration points per civilization per round
  baseCost: { 2: 10, 3: 15, 1: 20, 5: 15 },    // terrain id -> cost: lowland, hills, shallow sea, lake
  riverDiscount: 5,
  rainforestSurcharge: 5,
  distanceFactor: 1.2,                         // +20% per tile of distance from the spawn tile
};
const RAINFOREST = 1;                          // biome id
const round3 = (x) => Math.round(x * 1000) / 1000;

export class Exploration {
  // spawns: the starting tile of each civilization. seed: any string, for this system's own random stream.
  constructor(map, spawns, seed = '', opts = {}) {
    this.map = map;
    this.o = { ...EXPLORE_DEFAULTS, ...opts, baseCost: { ...EXPLORE_DEFAULTS.baseCost, ...(opts.baseCost || {}) } };
    this.rngState = hashSeed(`${seed}:explore`);
    this.owner = new Uint8Array(map.size);     // 0 = nobody, otherwise civilization number (1-based)
    this.version = 0;                          // goes up whenever ownership changes (the screen redraws on it)
    this.contacts = new Map();                 // "a-b" -> round when civilizations a and b first touched
    this.civs = spawns.map((spawn, k) => ({ spawn, bank: 0, count: 0, frontier: new Map() }));
    this.civs.forEach((c, k) => this.claim(k, c.spawn, 0, []));    // each civilization starts on its spawn tile
  }

  rand() {                                     // mulberry32 on the saved state
    this.rngState = (this.rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(this.rngState ^ (this.rngState >>> 15), 1 | this.rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Cost for civilization c to explore a tile, or null if that tile cannot be explored yet.
  cost(c, tile) {
    const map = this.map, o = this.o, base = o.baseCost[map.terrain[tile]];
    if (base === undefined) return null;                                   // mountains, deep ocean
    let b = base;
    if (map.river[tile]) b -= o.riverDiscount;
    if (map.biome[tile] === RAINFOREST) b += o.rainforestSurcharge;
    return round3(Math.max(1, b) * Math.pow(o.distanceFactor, hexDistance(map, c.spawn, tile)));
  }

  claim(k, tile, round, events) {
    const c = this.civs[k], map = this.map, W = map.cols;
    this.owner[tile] = k + 1;
    c.frontier.delete(tile);
    c.count++;
    this.version++;
    for (const [nc, nr] of map.neighbors(tile % W, (tile / W) | 0)) {
      const n = nr * W + nc, o = this.owner[n];
      if (o === 0) {
        if (!c.frontier.has(n)) { const cost = this.cost(c, n); if (cost !== null) c.frontier.set(n, cost); }
      } else if (o !== k + 1) {                                            // our border now touches another civilization
        const a = Math.min(k, o - 1), b = Math.max(k, o - 1), key = `${a}-${b}`;
        if (!this.contacts.has(key)) {
          this.contacts.set(key, round);
          events.push({ type: 'info', round, text: `Civilization ${a + 1} and civilization ${b + 1} have met.` });
        }
      }
    }
  }

  // The cheapest frontier cost of civilization k and every frontier tile at that cost, or null if it has none.
  cheapest(k) {
    const c = this.civs[k];
    let best = Infinity, tiles = [];
    for (const [tile, cost] of c.frontier) {
      if (this.owner[tile] !== 0) { c.frontier.delete(tile); continue; }  // someone else bought it meanwhile
      if (cost < best) { best = cost; tiles = [tile]; } else if (cost === best) tiles.push(tile);
    }
    return tiles.length ? { cost: best, tiles } : null;
  }

  buyOne(k, round, events) {
    const best = this.cheapest(k), c = this.civs[k];
    if (!best || c.bank < best.cost) return false;                         // nothing to buy, or not enough saved yet
    const tile = best.tiles[Math.floor(this.rand() * best.tiles.length)];  // ties: pick one at random
    c.bank = round3(c.bank - best.cost);
    this.claim(k, tile, round, events);
    return true;
  }

  // Play one round: everybody gets income, then they buy one tile at a time in turn until nobody can.
  // Returns the events that happened (contacts).
  tick(round) {
    const events = [], order = this.civs.map((c, k) => k);
    for (const c of this.civs) c.bank = round3(c.bank + this.o.income);
    // A round in which nobody can afford anything uses no randomness, so skipping idle rounds is exactly equivalent.
    if (!this.civs.some((c, k) => { const best = this.cheapest(k); return best && c.bank >= best.cost; })) return events;
    for (let i = order.length - 1; i > 0; i--) {                           // shuffled turn order, new every round
      const j = Math.floor(this.rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let bought = true;
    while (bought) {
      bought = false;
      for (const k of order) if (this.buyOne(k, round, events)) bought = true;
    }
    return events;
  }

  // ---- helpers for headless runs and the debug view ----------------------------------------
  exhausted() { return this.civs.every((c, k) => !this.cheapest(k)); }     // no civilization has any tile left to explore
  allMet() { const n = this.civs.length; return this.contacts.size === (n * (n - 1)) / 2; }

  // Idle rounds that can be skipped before the next round in which somebody can buy a tile.
  // (Skipping them is exactly equivalent to ticking them: nothing is bought, banks just grow.)
  idleRounds() {
    let wait = Infinity;
    this.civs.forEach((c, k) => {
      const best = this.cheapest(k);
      if (best) wait = Math.min(wait, Math.max(0, Math.ceil((best.cost - c.bank) / this.o.income - 1e-9) - 1));
    });
    return wait;
  }
  skip(rounds) { for (const c of this.civs) c.bank = round3(c.bank + rounds * this.o.income); }

  stats() { return this.civs.map(c => ({ tiles: c.count, bank: c.bank, frontier: c.frontier.size })); }
}
