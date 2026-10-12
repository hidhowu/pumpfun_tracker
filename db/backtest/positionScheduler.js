/**
 * Decides which position is simulated next, across ALL addresses that are being worked on.
 *
 * Every address registers a "source" that hands out its next position on request (`claim(speculative)`). A free slot goes to:
 *   1. the first address (oldest first) that still has a position of its CURRENT day waiting - a day is finished before the next one
 *      starts, so the early-stop rules (losing days, day loss cap...) judge a complete day and no work is wasted on later days of a
 *      trader that is about to be dropped;
 *   2. only when no address has such a position (every day is fully handed out and just waiting for its last trades), a position of
 *      the NEXT day - so a free proxy never sits idle. It is the only look-ahead, and it only uses capacity nothing else wanted.
 */
export class PositionScheduler {
  constructor() {
    this.limit = 1;
    this.running = 0;
    this.sources = []; // sorted by `order`, oldest address first
    this.timer = null;
    this.pumping = false;
  }

  setLimit(limit) {
    this.limit = Math.max(1, Math.floor(limit) || 1);
    this.pump();
  }

  /** @param {{ order: number, claim: (speculative: boolean) => ({ run: () => Promise<void> } | null), settle: () => void }} source */
  add(source) {
    const at = this.sources.findIndex((s) => s.order > source.order);
    if (at === -1) this.sources.push(source);
    else this.sources.splice(at, 0, source);
    // A stopped address (paused run, early stop) has to notice even when no position is finishing, so look in on them regularly.
    if (!this.timer) {
      this.timer = setInterval(() => this.pump(), 500);
      this.timer.unref?.();
    }
    this.pump();
  }

  remove(source) {
    this.sources = this.sources.filter((s) => s !== source);
    if (this.sources.length === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pump();
  }

  pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (const source of [...this.sources]) source.settle();
      while (this.running < this.limit) {
        const job = this.#next();
        if (!job) break;
        this.running += 1;
        job
          .run()
          .catch(() => {}) // a source records its own failures
          .finally(() => {
            this.running -= 1;
            this.pump();
          });
      }
    } finally {
      this.pumping = false;
    }
  }

  #next() {
    for (const source of this.sources) {
      const job = source.claim(false);
      if (job) return job;
    }
    for (const source of this.sources) {
      const job = source.claim(true);
      if (job) return job;
    }
    return null;
  }
}
