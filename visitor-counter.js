/* Shared daily browser-visit counter. No visitor identifiers leave the browser. */
(() => {
  'use strict';
  const BASE = 'https://countapi.mileshilliard.com/api/v1';
  const SITE = 'iraslab_visitors_ebf0929109aa8830284c431c';
  const STORE = `${SITE}:history`;
  const LOCK = `${SITE}:lock`;
  const allowed = new Set(['howaboutj.github.io', 'iras.postech.ac.kr']);
  if (!allowed.has(location.hostname)) return;

  const date = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  let storage;
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const candidate = window[name];
      candidate.setItem(`${STORE}:test`, '1');
      candidate.removeItem(`${STORE}:test`);
      storage = candidate;
      break;
    } catch (_) { /* Read-only counts if browser storage is disabled. */ }
  }
  const history = () => {
    try { return JSON.parse(storage.getItem(STORE) || '{}'); }
    catch (_) { return {}; }
  };
  function mark(day, kind, status) {
    if (!storage) return;
    const state = history();
    state[day] = { ...state[day], [kind]: status };
    const recent = Object.keys(state).sort().slice(-7);
    storage.setItem(STORE, JSON.stringify(Object.fromEntries(recent.map(d => [d, state[d]]))));
  }
  async function request(action, key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${BASE}/${action}/${encodeURIComponent(key)}`, {
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal
      });
      if (action === 'get' && response.status === 404) return 0;
      if (!response.ok) throw new Error('Counter unavailable');
      const data = await response.json();
      const count = Number(data.value);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid count');
      return count;
    } finally { clearTimeout(timer); }
  }
  function render(kind, count) {
    const node = document.getElementById(`visitor-${kind}`);
    if (node) node.textContent = new Intl.NumberFormat('en-US').format(count);
  }
  async function read(day, kind) {
    const key = kind === 'total' ? `${SITE}_total` : `${SITE}_day_${day}`;
    render(kind, await request('get', key));
  }
  async function record(day, kind) {
    const key = kind === 'total' ? `${SITE}_total` : `${SITE}_day_${day}`;
    const status = history()[day]?.[kind];
    if (!storage || status) return read(day, kind);
    // Record before sending: an interrupted response must not cause another increment.
    // Ambiguous failed requests are intentionally not retried on the same day.
    mark(day, kind, 'pending');
    render(kind, await request('hit', key));
    mark(day, kind, 'done');
  }
  async function sync(day, increment = true) {
    const results = await Promise.allSettled(['today', 'total'].map(kind =>
      increment ? record(day, kind) : read(day, kind)));
    const status = document.getElementById('visitor-counter-status');
    if (status) {
      const failed = results.some(r => r.status === 'rejected');
      status.textContent = failed ? 'Visitor count is temporarily unavailable.' : '';
      status.hidden = !failed;
    }
  }
  let busy = false;
  let currentDay;
  async function update() {
    if (busy || document.visibilityState === 'hidden') return;
    busy = true;
    const day = date();
    try {
      if (navigator.locks && storage) {
        await navigator.locks.request(LOCK, () => sync(day));
      } else if (storage) {
        // A short shared lease limits parallel tabs in browsers without Web Locks.
        let lease;
        try { lease = JSON.parse(storage.getItem(LOCK) || 'null'); } catch (_) {}
        if (lease?.until > Date.now()) {
          await sync(day, false);
        } else {
          const token = Math.random().toString(36).slice(2);
          storage.setItem(LOCK, JSON.stringify({ token, until: Date.now() + 35000 }));
          await new Promise(resolve => setTimeout(resolve, 75));
          const claim = JSON.parse(storage.getItem(LOCK) || 'null');
          if (claim?.token === token) {
            try { await sync(day); }
            finally {
              const last = JSON.parse(storage.getItem(LOCK) || 'null');
              if (last?.token === token) storage.removeItem(LOCK);
            }
          } else await sync(day, false);
        }
      } else await sync(day, false);
      currentDay = day;
    } catch (_) { /* Keep the page usable when a counter or browser feature fails. */ }
    finally { busy = false; }
  }
  update();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') update();
  });
  // Switch daily counters after Korean midnight without requiring a reload.
  setInterval(() => { if (date() !== currentDay) update(); }, 60000);
})();
