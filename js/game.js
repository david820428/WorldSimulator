// Game clock and event system. It is completely separate from world generation: it never reads
// or writes the map, so nothing that happens here can change terrain, resources or climate.
//
// Time is counted in whole rounds. Speed only changes how fast rounds arrive in real time
// (normal = one round every ROUND_MS), so outcomes never depend on speed or frame rate.
//
// Events (placeholders for now): an information event every 5 rounds, a decision event every 25.
// What happens when one fires depends on the mode:
//   1  pause on decisions only  - the game waits for a choice; information goes to the log
//   2  pause on every event     - information pauses too; the player presses Play to go on
//   3  never pause              - the system picks decisions at random; only Pause stops the game
// A decision always leaves the game paused after it is settled; the player presses Play to continue.

import { hashSeed } from './random.js';
import { Exploration } from './exploration.js';

export const ROUND_MS = 2000;                 // real time per round at normal speed
export const SPEEDS = [1, 2, 4, 8];
export const MODES = { 1: 'Pause on decisions', 2: 'Pause on every event', 3: 'Never pause (random choices)' };
export const INFO_EVERY = 5, DECISION_EVERY = 25;
const MAX_ROUNDS_PER_ADVANCE = 8;             // safety cap when one frame is very long
const LOG_LIMIT = 200;

// ---- placeholder content -------------------------------------------------------------------
const INFO_TEXTS = [
  'Scouts report a quiet season (placeholder).',
  'A traveller brings news from beyond the hills (placeholder).',
  'The harvest festival is celebrated (placeholder).',
  'A storm passes without harm (placeholder).',
  'Children play by the river (placeholder).',
];
const DECISIONS = [
  { title: 'A fork in the road', text: 'Your people disagree about what to do next (placeholder decision).',
    options: [{ label: 'Expand outward', result: 'The settlement grows.' },
              { label: 'Consolidate', result: 'The settlement grows stronger.' },
              { label: 'Send explorers', result: 'Scouts head into the unknown.' }] },
  { title: 'A stranger arrives', text: 'A stranger asks to join your people (placeholder decision).',
    options: [{ label: 'Welcome them', result: 'They share what they know.' },
              { label: 'Turn them away', result: 'They leave at dawn.' },
              { label: 'Watch and wait', result: 'They are quietly observed.' }] },
];

// Events that fire at the end of a round, in a fixed order (information first).
export function eventsForRound(round) {
  const out = [];
  if (round % INFO_EVERY === 0) out.push({ type: 'info', round, text: INFO_TEXTS[(round / INFO_EVERY - 1) % INFO_TEXTS.length] });
  if (round % DECISION_EVERY === 0) {
    const d = DECISIONS[(round / DECISION_EVERY - 1) % DECISIONS.length];
    out.push({ type: 'decision', round, ...d });
  }
  return out;
}

export class Game {
  // salt makes each playthrough different; passing the same seed and salt replays the same random choices
  constructor(seed, salt = 0, mode = 1) {
    this.seed = String(seed);
    this.salt = salt;
    this.rngState = hashSeed(`${this.seed}:${salt}:game`);   // saved with the game so a run can be resumed
    this.round = 0;
    this.speed = 1;
    this.mode = mode;
    this.playing = false;                  // the player's play / pause state
    this.pauseReason = 'start';            // 'start' | 'player' | 'event' | 'decision' | 'decided' | 'tab'
    this.progress = 0;                     // real ms into the current round, at normal-speed scale
    this.pending = null;                   // the decision waiting for the player
    this.queue = [];                       // events waiting to be handled
    this.entries = [];                     // the event log, oldest first
    this.version = 0;                      // goes up whenever anything the screen shows has changed
    this.civs = [];                        // starting tile of each civilization (see spawn.js)
    this.civWanted = 0;                    // how many were asked for
    this.explore = null;                   // exploration state (see exploration.js), created with the starting positions
  }

  // Start the exploration system from the civilizations' spawn tiles. The map is only read.
  startExploration(map) {
    this.explore = new Exploration(map, this.civs, `${this.seed}:${this.salt}`);
  }

  // Remember the starting positions and tell the player how many fitted.
  setSpawn({ tiles, wanted }) {
    this.civs = tiles;
    this.civWanted = wanted;
    this.log('system', `${tiles.length} of ${wanted} civilizations are placed.`, 0);
  }

  // The game only moves while the player has pressed Play and no decision is waiting.
  get running() { return this.playing && !this.pending; }
  get status() { return this.pending ? 'decision' : this.playing ? 'running' : this.pauseReason; }

  rand() {                                 // mulberry32 on the saved state
    this.rngState = (this.rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(this.rngState ^ (this.rngState >>> 15), 1 | this.rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  log(kind, text, round = this.round) {
    this.entries.push({ round, kind, text });
    if (this.entries.length > LOG_LIMIT) this.entries.shift();
    this.version++;
  }

  // ---- player controls ---------------------------------------------------------------
  play(speed = this.speed) {
    if (this.pending) return false;        // locked until the decision is made
    this.speed = speed;
    this.playing = true;
    this.version++;
    return true;
  }

  pause(reason = 'player') {
    const wasRunning = this.running;
    this.playing = false;
    this.pauseReason = reason;
    if (reason === 'tab' && wasRunning) this.log('system', 'Paused because the tab was hidden.');
    this.version++;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 3 && this.pending) {      // nobody is left to decide: the system picks right away
      const ev = this.pending;
      this.pending = null;
      this.pauseReason = 'decided';        // settled, but still paused until the player presses Play
      this.autoChoose(ev, 'Mode changed to "Never pause". ');
      this.drain();
    }
    this.version++;
  }

  choose(index) {
    const ev = this.pending;
    if (!ev || !ev.options[index]) return false;
    this.pending = null;
    this.pauseReason = 'decided';          // settled, but still paused until the player presses Play
    this.log('decision', `You chose "${ev.options[index].label}" for "${ev.title}". ${ev.options[index].result}`);
    this.drain();                          // more events from the same round may be waiting
    return true;                           // the game stays paused until the player presses Play
  }

  // ---- clock -------------------------------------------------------------------------
  // Advance by `ms` of real time. Returns how many rounds were played.
  advance(ms) {
    if (!this.running) return 0;
    this.progress += ms * this.speed;
    let played = 0;
    while (this.progress >= ROUND_MS && this.running && played < MAX_ROUNDS_PER_ADVANCE) {
      this.progress -= ROUND_MS;
      this.round++;
      played++;
      const found = this.explore ? this.explore.tick(this.round) : [];     // exploration happens every round
      this.queue.push(...found, ...eventsForRound(this.round));            // contact events, then the scheduled ones
      this.drain();                        // may pause the game: then we stop on exactly this round
    }
    if (!this.running) this.progress = 0;  // leftover time from a fast batch is discarded
    else this.progress = Math.min(this.progress, ROUND_MS - 1);
    this.version++;
    return played;
  }

  // ---- events ------------------------------------------------------------------------
  drain() {
    while (!this.pending && this.queue.length) {
      const ev = this.queue.shift();
      if (ev.type === 'info') {
        this.log('info', ev.text, ev.round);
        if (this.mode === 2) this.stop('event');
      } else if (this.mode === 3) {
        this.autoChoose(ev);
      } else {
        this.pending = ev;
        this.stop('decision');
        this.log('decision', `Decision needed: ${ev.title}`, ev.round);
      }
    }
  }

  autoChoose(ev, note = '') {
    const opt = ev.options[Math.floor(this.rand() * ev.options.length)];
    this.log('auto', `${note}The system chose "${opt.label}" for "${ev.title}". ${opt.result}`, ev.round);
  }

  stop(reason) {
    this.playing = false;
    this.pauseReason = reason;
    this.progress = 0;
  }
}
