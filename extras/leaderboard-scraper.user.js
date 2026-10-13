// ==UserScript==
// @name         Leaderboard address collector
// @namespace    local
// @version      2.1
// @description  Clicks "Next page" ~100 times in a row so the site fetches those pages, then walks back through them (instant, already loaded) reading the addresses - and keeps one de-duplicated list.
// @match        https://dune.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * HOW TO USE
 *   Tampermonkey: Dashboard -> "+" (new script) -> replace everything with this file -> Ctrl+S. Open the leaderboard page,
 *   a small panel appears bottom-right: Start / Stop / Copy / Download. Keep the tab in the foreground while it runs
 *   (browsers slow timers down in background tabs).
 *   No extension: open the page, F12 -> Console, paste this whole file, Enter (the panel appears the same way).
 *
 *   The panel has three page boxes (the page numbers are the ones the table's own pager counts):
 *     "I'm on"   the page the table is showing right now (1 after a reload - the site cannot be opened on another page)
 *     "Start at" the first page to read; it clicks its way there first (forward or back) without reading anything on the way
 *     "Stop at"  the last page to read (empty = until the data runs out)
 *   When a run ends, "I'm on" is set to where the table really is and "Start at" to the page after the last one read, so Start continues from there.
 *
 *   Collected addresses are also kept in localStorage ("collectedAddresses"), so a page reload does not lose them.
 *   In the console: window.collectedAddresses() returns the list.
 *
 * HOW IT WORKS
 *   The site starts the request for a page the moment "Next page" is clicked, whether or not you wait for it, and keeps the result.
 *   So instead of click -> wait 5s -> read, one round does this:
 *     1. click "Next page" until it is PREFETCH_PAGES pages past the last page read (fast, no waiting) - every page in between gets fetched
 *     2. let the last page finish loading
 *     3. click "Previous page" one page at a time; those pages are already loaded, so each one appears almost at once. The script
 *        reads it the moment the table changes (no fixed wait) - this walk down is what captures the pages
 *     4. one more "Previous page" to check it really is where it thinks it is (the first address must match the page read earlier), then repeat
 *   The end is found when a page comes up empty (or the table stops changing).
 */
(() => {
  const PREFETCH_PAGES = 100; // pages fetched ahead (and read on the way back) per round
  const MAX_PAGES = Infinity; // set a number to stop by itself
  const CLICK_DELAY_MS = 20; // pause between two quick clicks - too small and the site may swallow some of them
  const POLL_MS = 20; // how often the table is looked at while waiting for it to change
  const SETTLE_MS = 2000; // the far page counts as loaded when the table has not changed for this long
  const PAGE_TIMEOUT_MS = 15000; // a page that should have data but still shows the previous one this long = stuck
  const EMPTY_TIMEOUT_MS = 6000; // an empty table this long = no data on that page (past the end)
  // Once an empty page has been seen the pages below it up to the real end are empty too, and every real page is already loaded (the last prefetch
  // has settled), so nothing is slow any more: an unchanged empty table is called empty almost at once.
  const FAST_EMPTY_MS = 250;
  const FAST_STUCK_MS = 1500;
  const VERIFY_TIMEOUT_MS = 8000;
  const NAV = {
    next: ['Next page'],
    prev: ['Previous page', 'Prev page', 'Previous', 'Back'], // the aria-label of the "previous" button - add yours if none of these match
  };
  const STORE_KEY = "collectedAddresses";
  const RANGE_KEY = "collectorRange"; // the Start at / Stop at boxes, kept over a reload
  const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // a Solana wallet address

  if (window.__addressCollector) return; // already on the page (script pasted twice)

  const found = new Set();
  try {
    for (const a of JSON.parse(localStorage.getItem(STORE_KEY) || "[]")) found.add(a);
  } catch {}
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify([...found]));
    } catch {}
  };

  let lastTable = null;
  /** The table whose first column holds addresses (the dashboard has other tables too). */
  const findTable = () => {
    const table = [...document.querySelectorAll("table")].find((t) => {
      const cell = t.querySelector("tbody tr td:first-child");
      return cell && ADDRESS.test(cell.textContent.trim());
    });
    if (table) lastTable = table;
    return table || (lastTable && lastTable.isConnected ? lastTable : null); // an empty page may have no rows to recognise the table by
  };

  /** Addresses on the page now, in table order. */
  const readPage = () => {
    const table = findTable();
    if (!table) return [];
    return [...table.querySelectorAll("tbody tr")]
      .map((tr) => tr.querySelector("td:first-child")?.textContent.trim() || "")
      .filter((text) => ADDRESS.test(text));
  };

  const navCache = {};
  /** The "next" / "previous" button that belongs to that table: walk up until something around the table contains one. */
  const findNav = (kind) => {
    const cached = navCache[kind];
    if (cached && cached.isConnected) return cached;
    const selector = NAV[kind].map((label) => `[aria-label="${label}"]`).join(",");
    let node = findTable();
    while (node && node !== document.body) {
      const icon = node.querySelector(selector);
      if (icon) return (navCache[kind] = icon.closest("button") || icon);
      node = node.parentElement;
    }
    return null;
  };
  const isDisabled = (btn) => !btn || btn.disabled || btn.getAttribute("aria-disabled") === "true";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Polls until `test()` is true. Returns false on timeout. */
  async function waitUntil(test, timeoutMs) {
    const t0 = Date.now();
    while (!test()) {
      if (Date.now() - t0 >= timeoutMs) return false;
      await sleep(POLL_MS);
    }
    return true;
  }

  /** The table has not changed for SETTLE_MS (the last prefetched page has arrived). */
  async function waitSettled() {
    let last = readPage()[0];
    let since = Date.now();
    const t0 = since;
    while (Date.now() - since < SETTLE_MS && Date.now() - t0 < PAGE_TIMEOUT_MS * 2) {
      await sleep(POLL_MS);
      const now = readPage()[0];
      if (now !== last) {
        last = now;
        since = Date.now();
      }
    }
  }

  /**
   * After a click: waits for the table to show another page than the one whose first address is `avoid`, and returns it as soon as it does.
   *   ok     -> { rows }: a page with addresses, different from before
   *   empty  -> the table stayed empty: no data on that page
   *   stuck  -> still showing the same page: it did not change
   */
  async function waitForPage(avoid, fast) {
    const emptyMs = fast ? FAST_EMPTY_MS : EMPTY_TIMEOUT_MS;
    const stuckMs = fast ? FAST_STUCK_MS : PAGE_TIMEOUT_MS;
    const t0 = Date.now();
    for (;;) {
      const rows = readPage();
      if (rows.length > 0 && rows[0] !== avoid) return { status: "ok", rows };
      const waited = Date.now() - t0;
      if (rows.length === 0 && waited >= emptyMs) return { status: "empty", rows };
      if (rows.length > 0 && waited >= stuckMs) return { status: "stuck", rows };
      await sleep(POLL_MS);
    }
  }

  // ---- panel
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;flex-direction:column;gap:6px;padding:10px;width:230px;" +
    "background:#111;color:#eee;font:12px/1.4 system-ui,sans-serif;border:1px solid #444;border-radius:8px;box-shadow:0 4px 18px #0008";
  const status = document.createElement("div");
  status.textContent = "Ready";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
  const button = (label, onClick) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "flex:1;padding:5px 8px;background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:5px;cursor:pointer";
    b.onclick = onClick;
    row.appendChild(b);
    return b;
  };
  const pageBoxes = document.createElement("div");
  pageBoxes.style.cssText = "display:flex;gap:6px";
  /** A small labelled number box. */
  const pageBox = (label, value, placeholder, title) => {
    const wrap = document.createElement("label");
    wrap.style.cssText = "flex:1;display:flex;flex-direction:column;gap:2px;font-size:11px;color:#aaa";
    wrap.title = title;
    wrap.append(label);
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.value = value;
    input.placeholder = placeholder;
    input.style.cssText = "width:100%;box-sizing:border-box;padding:4px 6px;background:#1c1c1c;color:#eee;border:1px solid #555;border-radius:5px;font:12px system-ui,sans-serif";
    wrap.append(input);
    pageBoxes.append(wrap);
    return input;
  };
  let savedRange = {};
  try {
    savedRange = JSON.parse(localStorage.getItem(RANGE_KEY) || "{}") || {};
  } catch {}
  const currentInput = pageBox("I'm on", "1", "1", "The page the table is showing right now (1 after a reload)");
  const startInput = pageBox("Start at", savedRange.start ? String(savedRange.start) : "", "this page", "First page to read. Empty = the page you are on");
  const stopInput = pageBox("Stop at", savedRange.stop ? String(savedRange.stop) : "", "the end", "Last page to read. Empty = until the data runs out");
  const saveRange = () => {
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify({ start: Number(startInput.value) || null, stop: Number(stopInput.value) || null }));
    } catch {}
  };
  startInput.addEventListener("change", saveRange);
  stopInput.addEventListener("change", saveRange);
  panel.append(status, pageBoxes, row);
  document.body.appendChild(panel);

  let running = false;
  let stopRequested = false;
  let pages = 0;
  const show = (text) => {
    status.textContent = `${text} | pages ${pages} | addresses ${found.size}`;
  };

  /** Adds the addresses of a page to the list. Returns how many were new. */
  const addRows = (rows) => {
    let added = 0;
    for (const a of rows) {
      if (!found.has(a)) {
        found.add(a);
        added += 1;
      }
    }
    save();
    return added;
  };

  /** Clicks "next" / "previous" up to `n` times in quick succession. Stops early when the button is gone or stays disabled (or Stop is pressed). Returns the clicks made. */
  async function clickTimes(kind, n, progress) {
    let done = 0;
    while (done < n && !stopRequested) {
      let btn = findNav(kind);
      // a button can be briefly missing or disabled while the table re-renders: give it a moment before calling it the end
      for (let tries = 0; tries < 50 && isDisabled(btn); tries++) {
        await sleep(POLL_MS);
        btn = findNav(kind);
      }
      if (isDisabled(btn)) break;
      btn.click();
      done += 1;
      progress?.(done);
      await sleep(CLICK_DELAY_MS);
    }
    return done;
  }

  /** Reads the three page boxes. Returns null (and says why) when they do not make sense. */
  function readRange() {
    const num = (input, fallback) => {
      const v = input.value.trim();
      if (v === "") return fallback;
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 ? n : NaN;
    };
    const current = num(currentInput, 1);
    const start = num(startInput, current);
    const stop = num(stopInput, Infinity);
    if ([current, start, stop].some(Number.isNaN)) {
      show("Page numbers must be whole numbers from 1");
      return null;
    }
    if (stop < start) {
      show(`Stop page ${stop} is before the start page ${start}`);
      return null;
    }
    return { current, start, stop };
  }

  async function crawl({ current, start, stop }) {
    if (!findTable()) {
      show("No address table found on this page");
      return;
    }
    // Page numbers are the table's own. `cur` = the page the table is on, `top` = the highest page read so far.
    const firstRows = new Map(); // page -> its first address, to check the position later
    let readAny = false;
    const capture = (page, rows) => {
      const added = addRows(rows);
      firstRows.set(page, rows[0]);
      pages += 1;
      readAny = true;
      console.log(`[collector] page ${page}: +${added}, total ${found.size}`);
    };
    let cur = current;
    let top = start;
    let lost = false; // the position is no longer known
    let ended = false; // the data ran out, so there is no "next page to start at"
    try {
      // 0. go to the start page (no reading on the way)
      if (start !== current) {
        const kind = start > current ? "next" : "prev";
        const n = Math.abs(start - current);
        const done = await clickTimes(kind, n, (k) => show(`going to page ${start}: ${k}/${n}`));
        cur += kind === "next" ? done : -done;
        if (done < n) {
          show(stopRequested ? "Stopped" : `Could not get to page ${start} - stopped on page ${cur}`);
          return;
        }
        show(`letting page ${start} load`);
        await waitSettled();
      }
      const first = readPage();
      if (first.length === 0) {
        show(`Page ${start} has no addresses - finished`);
        return;
      }
      capture(start, first);
      show("Starting");
      await rounds();
    } finally {
      if (!lost) {
        currentInput.value = String(cur);
        if (readAny && !ended) startInput.value = String(top + 1);
        saveRange();
      }
    }

    async function rounds() {
      while (!stopRequested && pages < MAX_PAGES && top < stop) {
        const batch = Math.min(PREFETCH_PAGES, MAX_PAGES - pages, stop - top);
        let reachedEnd = false;

        // 1. fetch ahead: go to the page just past the `batch` pages that are to be read
        const clicks = top + batch + 1 - cur;
        const done = await clickTimes("next", clicks, (n) => show(`fetching ahead ${n}/${clicks}`));
        cur += done;

        // 2. let the last page load
        show("letting the last page load");
        await waitSettled();

        let newTop;
        if (done === clicks) {
          newTop = cur - 1; // the page we stand on is only the far end of the prefetch, it is read in a later round
        } else {
          // The button ran out (the real last page) or Stop was pressed: this page is the last one of the round, read it here.
          reachedEnd = !stopRequested;
          const rows = readPage();
          if (cur > top && rows.length > 0) capture(cur, rows);
          newTop = Math.max(cur, top);
        }

        // 3. walk back: every page is already loaded, so each shows up almost at once - read it the moment it changes
        const steps = Math.max(0, cur - (top + 1));
        let fast = false;
        for (let i = 0; i < steps; i++) {
          const prev = findNav("prev");
          if (isDisabled(prev)) {
            lost = true;
            show("No 'Previous page' button found - stopped (see NAV in the script)");
            return;
          }
          const avoid = readPage()[0];
          prev.click();
          cur -= 1;
          show(`reading page ${cur} (${i + 1}/${steps})`);
          const res = await waitForPage(avoid, fast);
          if (res.status === "ok") {
            capture(cur, res.rows);
            fast = false;
          } else {
            addRows(res.rows); // whatever is on screen is real data, but it cannot be tied to this page number
            reachedEnd = true;
            fast = true; // the pages below the end are empty, not slow
          }
        }

        if (reachedEnd) {
          ended = true;
          show("Reached the end - finished");
          return;
        }
        if (steps === 0) {
          top = newTop;
          show(stopRequested ? "Stopped" : "No new pages - finished");
          return;
        }

        // 4. check the position: one page back must be the page read earlier
        const prev = findNav("prev");
        if (isDisabled(prev)) {
          lost = true;
          show("No 'Previous page' button found - stopped (see NAV in the script)");
          return;
        }
        prev.click();
        cur -= 1;
        const expected = firstRows.get(top);
        const ok = await waitUntil(() => readPage()[0] === expected, VERIFY_TIMEOUT_MS);
        if (!ok) {
          lost = true;
          show("Lost track of the page - stopped (raise CLICK_DELAY_MS)");
          return;
        }
        top = newTop;
      }
      show(stopRequested ? "Stopped" : top >= stop ? `Reached page ${stop} - finished` : "Reached MAX_PAGES - finished");
    }
  }

  async function run() {
    if (running) return;
    const range = readRange();
    if (!range) return;
    saveRange();
    running = true;
    stopRequested = false;
    startButton.disabled = true;
    try {
      await crawl(range);
    } catch (err) {
      console.error("[collector]", err);
      show(`Error: ${err.message}`);
    } finally {
      running = false;
      startButton.disabled = false;
    }
  }

  const text = () => [...found].join("\n");
  const startButton = button("Start", run);
  button("Stop", () => {
    stopRequested = true;
    show("Stopping after this round...");
  });
  button("Copy", async () => {
    try {
      await navigator.clipboard.writeText(text());
      show("Copied");
    } catch {
      window.prompt("Copy the list (Ctrl+C):", text());
    }
  });
  button("Download", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text() + "\n"], { type: "text/plain" }));
    a.download = `addresses-${found.size}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  button("Clear", () => {
    if (!confirm("Forget all collected addresses?")) return;
    found.clear();
    save();
    show("Cleared");
  });

  window.__addressCollector = true;
  window.collectedAddresses = () => [...found];
  show("Ready - press Start");
})();
