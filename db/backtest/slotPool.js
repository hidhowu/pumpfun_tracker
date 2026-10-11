/**
 * Round-robin scheduler with a per-member rate limit, used for both the proxy
 * pool and the RPC pool.
 *
 * Every request first reserves a time slot (`reserve`), then sleeps until that
 * slot (`wait`). A member's slots are spaced 1000/rps apart, so no member ever
 * exceeds its rate no matter how many requests are in flight, and because the
 * member with the EARLIEST free slot is always chosen (ties broken by a
 * rotating start index), load spreads evenly: with equal rates this is plain
 * round-robin, and a faster member simply gets proportionally more requests.
 *
 * A member that was rate-limited (429) is `cool`ed down for the duration the
 * server asked for and is skipped until then - the other members keep going.
 */

export class SlotPool {
  constructor() {
    this.members = new Map(); // id -> { id, rps, nextAt, coolUntil, data }
    this.rotate = 0;
  }

  /** Replaces the member list, keeping the pacing/cooldown state of members that persist. */
  sync(defs) {
    const next = new Map();
    for (const def of defs) {
      const prev = this.members.get(def.id);
      next.set(def.id, {
        id: def.id,
        rps: Math.max(0.05, def.rps),
        nextAt: prev?.nextAt ?? 0,
        coolUntil: prev?.coolUntil ?? 0,
        data: def.data,
      });
    }
    this.members = next;
  }

  get size() {
    return this.members.size;
  }

  /** Reserves the earliest slot across members. `exclude` skips members that already failed this attempt. Returns null if no member is usable. */
  reserve({ exclude } = {}) {
    const list = [...this.members.values()].filter((m) => !exclude || !exclude.has(m.id));
    if (list.length === 0) return null;
    const now = Date.now();
    let best = null;
    let bestAt = Infinity;
    for (let i = 0; i < list.length; i++) {
      const m = list[(this.rotate + i) % list.length];
      const at = Math.max(now, m.nextAt, m.coolUntil);
      if (at < bestAt) {
        best = m;
        bestAt = at;
      }
    }
    this.rotate = (this.rotate + 1) % Math.max(1, list.length);
    best.nextAt = bestAt + 1000 / best.rps;
    return { member: best, waitMs: Math.max(0, bestAt - now) };
  }

  cool(id, ms) {
    const m = this.members.get(id);
    if (!m) return;
    m.coolUntil = Math.max(m.coolUntil, Date.now() + ms);
    m.nextAt = Math.max(m.nextAt, m.coolUntil);
  }
}

/** Counting semaphore with a limit that can change while work is waiting. */
export class Semaphore {
  constructor(limit = 1) {
    this.limit = Math.max(1, limit);
    this.active = 0;
    this.queue = [];
  }

  setLimit(limit) {
    this.limit = Math.max(1, limit);
    this.#drain();
  }

  async acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    this.active -= 1;
    this.#drain();
  }

  #drain() {
    while (this.queue.length > 0 && this.active < this.limit) {
      this.active += 1;
      this.queue.shift()();
    }
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
